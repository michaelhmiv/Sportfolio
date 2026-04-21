package sportfolio.market;

import android.app.Activity;
import android.util.Log;
import androidx.annotation.NonNull;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

@CapacitorPlugin(name = "AndroidPlayBilling")
public class AndroidPlayBillingPlugin extends Plugin implements PurchasesUpdatedListener {
    private static final String TAG = "AndroidPlayBilling";

    private BillingClient billingClient;
    private final List<ConnectionRequest> pendingConnectionCallbacks = new CopyOnWriteArrayList<>();
    private volatile boolean isConnecting = false;

    private PluginCall pendingPurchaseCall;
    private String pendingPurchaseProductId;

    private interface BillingClientReadyCallback {
        void onReady(BillingClient client);
    }

    private static final class ConnectionRequest {
        final PluginCall call;
        final BillingClientReadyCallback callback;

        ConnectionRequest(PluginCall call, BillingClientReadyCallback callback) {
            this.call = call;
            this.callback = callback;
        }
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        Activity activity = getActivity();
        JSObject result = new JSObject();
        result.put("available", activity != null);
        result.put("connected", billingClient != null && billingClient.isReady());
        call.resolve(result);
    }

    @PluginMethod
    public void queryProducts(PluginCall call) {
        JSArray productIdsArray = call.getArray("productIds");
        if (productIdsArray == null || productIdsArray.length() == 0) {
            call.reject("productIds must include at least one product ID");
            return;
        }

        List<String> productIds = new ArrayList<>();
        for (int i = 0; i < productIdsArray.length(); i++) {
            String id = productIdsArray.optString(i, "");
            if (id != null) {
                id = id.trim();
            }
            if (id != null && !id.isEmpty()) {
                productIds.add(id);
            }
        }

        if (productIds.isEmpty()) {
            call.reject("productIds must include at least one non-empty product ID");
            return;
        }

        withReadyBillingClient(call, client -> queryProductDetails(client, productIds, call));
    }

    @PluginMethod
    public void purchase(PluginCall call) {
        String productId = call.getString("productId");
        if (productId == null || productId.trim().isEmpty()) {
            call.reject("productId is required");
            return;
        }
        productId = productId.trim();

        synchronized (this) {
            if (pendingPurchaseCall != null) {
                call.reject("A purchase flow is already in progress");
                return;
            }
        }

        final String normalizedProductId = productId;
        withReadyBillingClient(call, client ->
            querySingleProductDetails(client, normalizedProductId, new ProductQueryCallback() {
                @Override
                public void onSuccess(
                    ProductDetails productDetails,
                    ProductDetails.OneTimePurchaseOfferDetails offerDetails
                ) {
                    launchPurchaseFlow(call, client, productDetails, offerDetails);
                }

                @Override
                public void onError(String message) {
                    call.reject(message);
                }
            })
        );
    }

    @PluginMethod
    public void getPurchases(PluginCall call) {
        withReadyBillingClient(call, client -> {
            QueryPurchasesParams params =
                QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build();
            client.queryPurchasesAsync(params, (billingResult, purchasesList) -> {
                if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    call.reject(
                        "Could not fetch purchases: " + billingResult.getDebugMessage()
                    );
                    return;
                }

                JSArray purchases = new JSArray();
                if (purchasesList != null) {
                    for (Purchase purchase : purchasesList) {
                        purchases.put(toPurchaseJson(purchase));
                    }
                }

                JSObject payload = new JSObject();
                payload.put("purchases", purchases);
                call.resolve(payload);
            });
        });
    }

    private void withReadyBillingClient(PluginCall call, BillingClientReadyCallback callback) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No active Android activity is available");
            return;
        }

        if (billingClient == null) {
            billingClient =
                BillingClient
                    .newBuilder(activity)
                    .setListener(this)
                    .enablePendingPurchases()
                    .build();
        }

        if (billingClient.isReady()) {
            callback.onReady(billingClient);
            return;
        }

        pendingConnectionCallbacks.add(new ConnectionRequest(call, callback));
        if (isConnecting) {
            return;
        }

        isConnecting = true;
        billingClient.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(@NonNull BillingResult billingResult) {
                isConnecting = false;

                if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    String message =
                        "Google Play Billing unavailable: " + billingResult.getDebugMessage();
                    List<ConnectionRequest> callbacks = new ArrayList<>(
                        pendingConnectionCallbacks
                    );
                    pendingConnectionCallbacks.clear();
                    for (ConnectionRequest pending : callbacks) {
                        pending.call.reject(message);
                    }
                    return;
                }

                Log.d(TAG, "Billing client connected");
                List<ConnectionRequest> callbacks = new ArrayList<>(
                    pendingConnectionCallbacks
                );
                pendingConnectionCallbacks.clear();
                for (ConnectionRequest pending : callbacks) {
                    pending.callback.onReady(billingClient);
                }
            }

            @Override
            public void onBillingServiceDisconnected() {
                Log.w(TAG, "Billing service disconnected");
            }
        });
    }

    private interface ProductQueryCallback {
        void onSuccess(
            ProductDetails productDetails,
            ProductDetails.OneTimePurchaseOfferDetails offerDetails
        );
        void onError(String message);
    }

    private void querySingleProductDetails(
        BillingClient client,
        String productId,
        ProductQueryCallback callback
    ) {
        List<String> ids = new ArrayList<>();
        ids.add(productId);

        QueryProductDetailsParams params = buildProductDetailsParams(ids);
        client.queryProductDetailsAsync(params, (billingResult, queryResult) -> {
            if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                callback.onError(
                    "Could not query product details: " + billingResult.getDebugMessage()
                );
                return;
            }

            List<ProductDetails> productDetailsList = queryResult.getProductDetailsList();
            if (productDetailsList == null || productDetailsList.isEmpty()) {
                callback.onError("No Google Play product details found for " + productId);
                return;
            }

            ProductDetails target = null;
            for (ProductDetails details : productDetailsList) {
                if (productId.equals(details.getProductId())) {
                    target = details;
                    break;
                }
            }

            if (target == null) {
                target = productDetailsList.get(0);
            }

            ProductDetails.OneTimePurchaseOfferDetails offerDetails = resolveOneTimeOffer(target);
            if (offerDetails == null) {
                callback.onError("No one-time purchase offer is available for " + target.getProductId());
                return;
            }

            callback.onSuccess(target, offerDetails);
        });
    }

    private QueryProductDetailsParams buildProductDetailsParams(List<String> productIds) {
        List<QueryProductDetailsParams.Product> products = new ArrayList<>();
        for (String productId : productIds) {
            products.add(
                QueryProductDetailsParams
                    .Product
                    .newBuilder()
                    .setProductId(productId)
                    .setProductType(BillingClient.ProductType.INAPP)
                    .build()
            );
        }

        return QueryProductDetailsParams.newBuilder().setProductList(products).build();
    }

    private void queryProductDetails(BillingClient client, List<String> productIds, PluginCall call) {
        QueryProductDetailsParams params = buildProductDetailsParams(productIds);
        client.queryProductDetailsAsync(params, (billingResult, queryResult) -> {
            if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                call.reject("Could not query products: " + billingResult.getDebugMessage());
                return;
            }

            JSArray products = new JSArray();
            List<ProductDetails> productDetailsList = queryResult.getProductDetailsList();
            if (productDetailsList != null) {
                for (ProductDetails details : productDetailsList) {
                    products.put(toProductJson(details));
                }
            }

            JSObject payload = new JSObject();
            payload.put("products", products);
            call.resolve(payload);
        });
    }

    private JSObject toProductJson(ProductDetails details) {
        ProductDetails.OneTimePurchaseOfferDetails offerDetails = resolveOneTimeOffer(details);

        JSObject product = new JSObject();
        product.put("productId", details.getProductId());
        product.put("title", details.getTitle());
        product.put("description", details.getDescription());
        product.put("productType", details.getProductType());
        if (offerDetails != null) {
            product.put("formattedPrice", offerDetails.getFormattedPrice());
            product.put("priceCurrencyCode", offerDetails.getPriceCurrencyCode());
            product.put("priceAmountMicros", offerDetails.getPriceAmountMicros());
            product.put("offerToken", offerDetails.getOfferToken());
        }
        return product;
    }

    private ProductDetails.OneTimePurchaseOfferDetails resolveOneTimeOffer(ProductDetails details) {
        List<ProductDetails.OneTimePurchaseOfferDetails> offers =
            details.getOneTimePurchaseOfferDetailsList();
        if (offers != null && !offers.isEmpty()) {
            return offers.get(0);
        }

        return details.getOneTimePurchaseOfferDetails();
    }

    private void launchPurchaseFlow(
        PluginCall call,
        BillingClient client,
        ProductDetails productDetails,
        ProductDetails.OneTimePurchaseOfferDetails offerDetails
    ) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No active Android activity is available");
            return;
        }

        BillingFlowParams.ProductDetailsParams.Builder productParamsBuilder =
            BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(productDetails);
        String offerToken = offerDetails.getOfferToken();
        if (offerToken != null && !offerToken.isEmpty()) {
            productParamsBuilder.setOfferToken(offerToken);
        }

        BillingFlowParams.Builder flowBuilder =
            BillingFlowParams
                .newBuilder()
                .setProductDetailsParamsList(Collections.singletonList(productParamsBuilder.build()));

        String obfuscatedAccountId = call.getString("obfuscatedAccountId");
        if (obfuscatedAccountId != null && !obfuscatedAccountId.trim().isEmpty()) {
            flowBuilder.setObfuscatedAccountId(obfuscatedAccountId.trim());
        }

        String obfuscatedProfileId = call.getString("obfuscatedProfileId");
        if (obfuscatedProfileId != null && !obfuscatedProfileId.trim().isEmpty()) {
            flowBuilder.setObfuscatedProfileId(obfuscatedProfileId.trim());
        }

        synchronized (this) {
            pendingPurchaseCall = call;
            pendingPurchaseProductId = productDetails.getProductId();
        }

        activity.runOnUiThread(() -> {
            BillingResult launchResult = client.launchBillingFlow(activity, flowBuilder.build());
            if (launchResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                clearPendingPurchaseCall();
                call.reject("Could not start purchase flow: " + launchResult.getDebugMessage());
            }
        });
    }

    @Override
    public void onPurchasesUpdated(@NonNull BillingResult billingResult, List<Purchase> purchases) {
        PluginCall call;
        String expectedProductId;
        synchronized (this) {
            call = pendingPurchaseCall;
            expectedProductId = pendingPurchaseProductId;
            pendingPurchaseCall = null;
            pendingPurchaseProductId = null;
        }

        if (call == null) {
            if (purchases != null) {
                JSArray updates = new JSArray();
                for (Purchase purchase : purchases) {
                    updates.put(toPurchaseJson(purchase));
                }
                JSObject payload = new JSObject();
                payload.put("purchases", updates);
                notifyListeners("purchasesUpdated", payload);
            }
            return;
        }

        int responseCode = billingResult.getResponseCode();
        if (responseCode == BillingClient.BillingResponseCode.USER_CANCELED) {
            call.reject("Purchase canceled");
            return;
        }

        if (responseCode != BillingClient.BillingResponseCode.OK) {
            call.reject("Purchase failed: " + billingResult.getDebugMessage());
            return;
        }

        if (purchases == null || purchases.isEmpty()) {
            call.reject("Purchase did not return any results");
            return;
        }

        Purchase targetPurchase = purchases.get(0);
        if (expectedProductId != null && !expectedProductId.isEmpty()) {
            for (Purchase purchase : purchases) {
                List<String> products = purchase.getProducts();
                if (products != null && products.contains(expectedProductId)) {
                    targetPurchase = purchase;
                    break;
                }
            }
        }

        call.resolve(toPurchaseJson(targetPurchase));
    }

    private JSObject toPurchaseJson(Purchase purchase) {
        JSObject payload = new JSObject();
        payload.put("purchaseToken", purchase.getPurchaseToken());
        payload.put("orderId", purchase.getOrderId());
        payload.put("acknowledged", purchase.isAcknowledged());
        payload.put("purchaseTime", purchase.getPurchaseTime());
        payload.put("purchaseState", purchaseStateLabel(purchase.getPurchaseState()));
        payload.put("originalJson", purchase.getOriginalJson());
        payload.put("signature", purchase.getSignature());

        JSArray products = new JSArray();
        List<String> productIds = purchase.getProducts();
        if (productIds != null) {
            for (String productId : productIds) {
                products.put(productId);
            }
        }
        payload.put("products", products);
        return payload;
    }

    private String purchaseStateLabel(int purchaseState) {
        if (purchaseState == Purchase.PurchaseState.PURCHASED) {
            return "purchased";
        }
        if (purchaseState == Purchase.PurchaseState.PENDING) {
            return "pending";
        }
        return "unspecified";
    }

    private synchronized void clearPendingPurchaseCall() {
        pendingPurchaseCall = null;
        pendingPurchaseProductId = null;
    }
}
