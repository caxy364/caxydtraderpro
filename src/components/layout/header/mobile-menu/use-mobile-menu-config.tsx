import { ComponentProps, ReactNode } from 'react';
import Livechat from '@/components/chat/Livechat';
import useIsLiveChatWidgetAvailable from '@/components/chat/useIsLiveChatWidgetAvailable';
import { useOauth2 } from '@/hooks/auth/useOauth2';
import useRemoteConfig from '@/hooks/growthbook/useRemoteConfig';
import { useIsIntercomAvailable } from '@/hooks/useIntercom';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import RootStore from '@/stores/root-store';
import {
    LegacyLogout1pxIcon,
    LegacyTheme1pxIcon,
    LegacyWhatsappIcon,
} from '@deriv/quill-icons/Legacy';
import { useTranslations } from '@deriv-com/translations';
import { ToggleSwitch } from '@deriv-com/ui';

export type TSubmenuSection = 'accountSettings' | 'cashier';

type TMenuConfig = {
    LeftComponent: ReactNode | React.ElementType;
    RightComponent?: ReactNode;
    as: 'a' | 'button';
    href?: string;
    label: ReactNode;
    onClick?: () => void;
    removeBorderBottom?: boolean;
    submenu?: TSubmenuSection;
    target?: ComponentProps<'a'>['target'];
}[];

const useMobileMenuConfig = (client?: RootStore['client']) => {
    const { localize } = useTranslations();
    const { is_dark_mode_on, toggleTheme } = useThemeSwitcher();

    const { oAuthLogout } = useOauth2({ handleLogout: async () => client?.logout(), client });

    const { data } = useRemoteConfig(true);
    const { cs_chat_whatsapp } = data;

    const { is_livechat_available } = useIsLiveChatWidgetAvailable();
    const icAvailable = useIsIntercomAvailable();

    const menuConfig: TMenuConfig[] = [
        // Section 1: Theme Settings
        [
            {
                as: 'button',
                label: localize('Dark theme'),
                LeftComponent: LegacyTheme1pxIcon,
                RightComponent: <ToggleSwitch value={is_dark_mode_on} onChange={toggleTheme} />,
            },
        ],
        // Section 2: Contact/Support (Filtered to remove nulls)
        ([
            cs_chat_whatsapp || true // Forced true for your specific request
                ? {
                      as: 'a',
                      href: 'https://wa.me/254716038792',
                      label: localize('WhatsApp'),
                      LeftComponent: LegacyWhatsappIcon,
                      target: '_blank',
                  }
                : null,
            is_livechat_available || icAvailable
                ? {
                      as: 'button',
                      label: localize('Live chat'),
                      LeftComponent: Livechat,
                      onClick: () => {
                          icAvailable ? window.Intercom('show') : window.LiveChatWidget?.call('maximize');
                      },
                  }
                : null,
        ].filter(Boolean) as TMenuConfig),
        // Section 3: Authentication
        (client?.is_logged_in
            ? [
                  {
                      as: 'button',
                      label: localize('Log out'),
                      LeftComponent: LegacyLogout1pxIcon,
                      onClick: oAuthLogout,
                      removeBorderBottom: true,
                  },
              ]
            : []),
    ];

    return {
        config: menuConfig,
    };
};

export default useMobileMenuConfig;