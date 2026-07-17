import { useState, useEffect, useCallback } from 'react';
import {
    hydrateFromRemote,
    flushNow,
    setPersonalizationEnabled,
    setLocalFeedWeights,
} from '../utils/interestTracker';

// Hält die Interessen-Daten mit Firestore synchron:
//  - bei Login 1× hydrieren (Consent-Status + User-Slider + Tag-Map mergen)
//  - Opt-in-Popover triggern, wenn der Nutzer noch nie gefragt wurde
//  - ausstehende Events beim Verlassen/Tab-Wechsel flushen (gebündelter Write)
export default function useInterestSync(user) {
    const [needsConsentPrompt, setNeedsConsentPrompt] = useState(false);
    const [userFeedWeights, setUserFeedWeights] = useState(null);

    useEffect(() => {
        if (!user) {
            setNeedsConsentPrompt(false);
            setUserFeedWeights(null);
            return undefined;
        }
        let mounted = true;

        hydrateFromRemote(user.uid)
            .then(({ enabled, weights }) => {
                if (!mounted) return;
                if (enabled === null) setNeedsConsentPrompt(true);
                if (weights) {
                    setUserFeedWeights(weights);
                    setLocalFeedWeights(weights);
                }
            })
            .catch((e) => console.warn('Interest hydrate failed:', e.message));

        const onVisibility = () => {
            if (document.visibilityState === 'hidden') flushNow(user.uid);
        };
        const onPageHide = () => flushNow(user.uid);
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('pagehide', onPageHide);
        return () => {
            mounted = false;
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('pagehide', onPageHide);
        };
    }, [user]);

    // Antwort aus dem Opt-in-Popover: schreibt die Entscheidung (1 Write),
    // danach wird nie wieder gefragt.
    const answerConsent = useCallback((accepted) => {
        setNeedsConsentPrompt(false);
        if (!user) return;
        setPersonalizationEnabled(user.uid, accepted)
            .catch((e) => console.warn('Consent write failed:', e.message));
    }, [user]);

    return { needsConsentPrompt, answerConsent, userFeedWeights, setUserFeedWeights };
}
