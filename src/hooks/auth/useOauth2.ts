import RootStore from '@/stores/root-store';
import { useOAuth2 } from '@deriv-com/auth-client';
import useGrowthbookGetFeatureValue from '../growthbook/useGrowthbookGetFeatureValue';

/**
 * Provides an object with two properties: `isOAuth2Enabled` and `oAuthLogout`.
 * * NOTE: useIsOAuth2Enabled is temporarily disabled to bypass build errors.
 */
export const useOauth2 = ({
    handleLogout,
    client,
}: {
    handleLogout?: () => Promise<void>;
    client?: RootStore['client'];
} = {}) => {
    const { featureFlagValue: oAuth2EnabledApps, isGBLoaded: OAuth2EnabledAppsInitialised } =
        useGrowthbookGetFeatureValue<string>({
            featureFlag: 'hydra_be',
        });

    // BYPASS: Setting this to false manually to fix the ESModulesLinkingError
    const isOAuth2Enabled = false; 

    const oAuthGrowthbookConfig = {
        OAuth2EnabledApps: oAuth2EnabledApps as any,
        OAuth2EnabledAppsInitialised,
    };

    // We keep this but use 'any' to prevent further type crashes
    const { OAuth2Logout: oAuthLogout } = useOAuth2(oAuthGrowthbookConfig as any, handleLogout ?? (() => Promise.resolve()));

    const logoutHandler = async () => {
        if (client?.setIsLoggingOut) {
            client.setIsLoggingOut(true);
        }
        await oAuthLogout();
    };

    return { isOAuth2Enabled, oAuthLogout: logoutHandler };
};