import React, { useState, useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import Spinner from '../ui/Spinner';

const ProtectedRoute = ({ children, user, userProfile, requiredRole, checkCommunityOwnership, setShowRickRoll }) => {
    // Die Community kann je nach Route direkt in den Params stehen (:id beim
    // Community-Manager, :communityId beim Event-Erstellen) oder muss über das
    // Event-Dokument aufgelöst werden (:eventId bei /event/…/edit|manage).
    const { id, communityId: communityIdParam, eventId } = useParams();
    const communityId = communityIdParam || id;
    const [isAuthorized, setIsAuthorized] = useState(null); // null = loading, true = authorized, false = unauthorized

    useEffect(() => {
        // If the user or their profile hasn't loaded yet, we can't make a decision.
        if (!user || !userProfile) {
            return;
        }

        const checkPermissions = async () => {
            // First, check if the user's email is verified. This is now a requirement for all protected routes.
            if (!user.emailVerified) {
                setIsAuthorized(false);
                return;
            }

            // Check for general role requirements
            if (requiredRole) {
                const rolesHierarchy = { 'user': 1, 'influencer': 2, 'moderator': 3, 'admin': 4 };
                const userLevel = rolesHierarchy[userProfile.role] || 0;
                const requiredLevel = rolesHierarchy[requiredRole];
                if (userLevel < requiredLevel) {
                    setIsAuthorized(false);
                    return;
                }
            }

            // Check for community-specific staff roles
            if (checkCommunityOwnership && (communityId || eventId)) {
                if (userProfile.role === 'admin' || userProfile.role === 'moderator') {
                    setIsAuthorized(true);
                    return;
                }
                let effectiveCommunityId = communityId;
                if (!effectiveCommunityId && eventId) {
                    const eventSnap = await getDoc(doc(db, 'events', eventId));
                    effectiveCommunityId = eventSnap.exists() ? eventSnap.data().communityId : null;
                }
                if (!effectiveCommunityId) {
                    setIsAuthorized(false);
                    return;
                }
                const memberRef = doc(db, 'communitys', effectiveCommunityId, 'members', user.uid);
                const memberSnap = await getDoc(memberRef);
                if (memberSnap.exists()) {
                    const memberData = memberSnap.data();
                    if (memberData.roles?.includes('owner') || memberData.roles?.includes('moderator')) {
                        setIsAuthorized(true);
                        return;
                    }
                }
                setIsAuthorized(false);
                return;
            }

            // If no other checks failed, the user is authorized.
            setIsAuthorized(true);
        };

        checkPermissions();
    }, [user, userProfile, requiredRole, checkCommunityOwnership, communityId, eventId]);

    // Handle the user not being logged in at all.
    if (!user) {
        return <Navigate to="/login" replace />;
    }

    // Show a spinner while authorization checks are running.
    if (isAuthorized === null) {
        return <div className="h-screen flex justify-center items-center"><Spinner /></div>;
    }

    // If authorization failed for any reason, redirect.
    if (!isAuthorized) {
        // The banner in App.js will inform unverified users why they can't proceed.
        // For other permission failures, the rickroll will be shown if triggered.
        return <Navigate to="/" replace />;
    }

    // If authorized, show the protected content.
    return children;
};

export default ProtectedRoute;