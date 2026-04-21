package sportfolio.market;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AndroidRewardedAdsPlugin.class);
        registerPlugin(AndroidPlayBillingPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
