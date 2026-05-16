import { DERIV_APP_ID } from '@/constants/deriv-app-config';

export const redirectToLogin = () => {
    window.location.href = `https://oauth.deriv.com/oauth2/authorize?app_id=${DERIV_APP_ID}`;
};
