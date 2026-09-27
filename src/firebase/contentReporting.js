import {getFunctions, httpsCallable} from 'firebase/functions';
export const submitContentReport = async (target, reason, category=target.mediaUrl?'images':'other') => (await httpsCallable(getFunctions(), 'submitContentReport')({...target, reason, category})).data;
