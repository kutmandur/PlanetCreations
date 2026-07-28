import { getToken } from 'firebase/app-check';
import { appCheck } from './config';

export const getAppCheckTokenIfAvailable = async () => {
    if (!appCheck) return null;
    const result = await getToken(appCheck, false);
    return result.token || null;
};
