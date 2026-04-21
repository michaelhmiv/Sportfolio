import { registerPlugin } from "@capacitor/core";
import { isNativeAndroid } from "./native-platform";

export interface AndroidPlayProduct {
  productId: string;
  title: string;
  description: string;
  productType: string;
  formattedPrice?: string;
  priceCurrencyCode?: string;
  priceAmountMicros?: number;
  offerToken?: string;
}

export interface AndroidPlayPurchase {
  purchaseToken: string;
  orderId?: string;
  products: string[];
  acknowledged: boolean;
  purchaseTime: number;
  purchaseState: "purchased" | "pending" | "unspecified";
  originalJson?: string;
  signature?: string;
}

interface AndroidPlayBillingPlugin {
  isAvailable(): Promise<{ available: boolean; connected: boolean }>;
  queryProducts(options: { productIds: string[] }): Promise<{ products: AndroidPlayProduct[] }>;
  purchase(options: {
    productId: string;
    obfuscatedAccountId?: string;
    obfuscatedProfileId?: string;
  }): Promise<AndroidPlayPurchase>;
  getPurchases(): Promise<{ purchases: AndroidPlayPurchase[] }>;
}

const AndroidPlayBilling = registerPlugin<AndroidPlayBillingPlugin>("AndroidPlayBilling");

export async function isAndroidPlayBillingAvailable() {
  if (!isNativeAndroid()) {
    return false;
  }

  try {
    const response = await AndroidPlayBilling.isAvailable();
    return response.available;
  } catch {
    return false;
  }
}

export async function queryAndroidPlayProducts(productIds: string[]) {
  if (!isNativeAndroid()) {
    return [] as AndroidPlayProduct[];
  }

  const response = await AndroidPlayBilling.queryProducts({ productIds });
  return response.products || [];
}

export async function purchaseAndroidPlayProduct(options: {
  productId: string;
  obfuscatedAccountId?: string;
  obfuscatedProfileId?: string;
}) {
  if (!isNativeAndroid()) {
    throw new Error("Google Play Billing is only available on Android");
  }

  return AndroidPlayBilling.purchase(options);
}

export async function getAndroidPlayPurchases() {
  if (!isNativeAndroid()) {
    return [] as AndroidPlayPurchase[];
  }

  const response = await AndroidPlayBilling.getPurchases();
  return response.purchases || [];
}
