import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, setPersistence, browserSessionPersistence, browserLocalPersistence, sendEmailVerification, sendPasswordResetEmail } from 'firebase/auth';
import { doc, setDoc, writeBatch, getDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../../firebase/config';
import { getGameColor, containsBlacklistedWord } from '../../utils/helpers';
import Spinner from '../ui/Spinner';
import PasswordInput from '../ui/PasswordInput';
import PasswordStrengthIndicator from '../ui/PasswordStrengthIndicator';

const AuthPage = ({ setModalMessage, activeTab, blacklist }) => {
    const [authAction, setAuthAction] = useState('login'); // 'login', 'register', or 'reset'
    const [emailOrUsername, setEmailOrUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [username, setUsername] = useState('');
    const [loading, setLoading] = useState(false);
    const color = getGameColor(activeTab);

    const navigate = useNavigate();

    const validatePassword = () => {
        const checks = {
            length: password.length >= 10,
            uppercase: /[A-Z]/.test(password),
            number: /[0-9]/.test(password),
            special: /[^A-Za-z0-9]/.test(password),
        };
        return Object.values(checks).every(Boolean);
    };

    const handlePasswordReset = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            await sendPasswordResetEmail(auth, emailOrUsername);
            setModalMessage("If an account with that email exists, a password reset link has been sent.");
            setAuthAction('login');
        } catch (error) {
            setModalMessage(error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            const consent = localStorage.getItem('cookie_consent');
            const persistence = consent === 'accepted' ? browserLocalPersistence : browserSessionPersistence;
            await setPersistence(auth, persistence);

            if (authAction === 'login') {
                let finalEmail = emailOrUsername.trim();
                
                if (!finalEmail.includes('@')) {
                    const usernameLower = finalEmail.toLowerCase();
                    const usernameRef = doc(db, 'usernames', usernameLower);
                    const usernameSnap = await getDoc(usernameRef);

                    if (usernameSnap.exists()) {
                        const foundEmail = usernameSnap.data().email;
                        if (foundEmail) {
                            finalEmail = foundEmail;
                        } else {
                            throw new Error("An error occurred with this username. Please try logging in with your email address.");
                        }
                    } else {
                        throw new Error("User not found. Please check your username or email.");
                    }
                }
                await signInWithEmailAndPassword(auth, finalEmail, password);
                navigate('/');

            } else { // Registration logic
                const email = emailOrUsername.trim();
                const finalUsername = username.trim();

                if (containsBlacklistedWord(finalUsername, blacklist)) {
                    throw new Error("Username contains a forbidden word.");
                }
                if (containsBlacklistedWord(email, blacklist)) {
                    throw new Error("Email contains a forbidden word.");
                }
                if (password !== confirmPassword) {
                    throw new Error("Passwords do not match.");
                }
                if (!validatePassword()) {
                    throw new Error("Password does not meet all the required criteria.");
                }
                if(finalUsername.length < 3) {
                    throw new Error("Username must be at least 3 characters long.");
                }

                const usernameLower = finalUsername.toLowerCase();
                const usernameRef = doc(db, 'usernames', usernameLower);
                const usernameSnap = await getDoc(usernameRef);
                if (usernameSnap.exists()) {
                    throw new Error("This username is already taken. Please choose another one.");
                }

                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                await sendEmailVerification(user);
                setModalMessage("Registration successful! A verification link has been sent to your email.");

                const batch = writeBatch(db);

                const userDocRef = doc(db, 'users', user.uid);
                batch.set(userDocRef, { role: 'user', createdAt: serverTimestamp() });

                const profileDocRef = doc(db, 'profiles', user.uid);
                batch.set(profileDocRef, {
                    username: finalUsername, // Original case for display
                    username_lowercase: usernameLower, // Lowercase for searching
                    role: 'user', // Add initial role for correct display in search
                    bio: '', country: '', profilePictureUrl: '', favoriteGame: 'planet-coaster-2', ownedDlcs: {}
                });

                batch.set(usernameRef, { email: email.toLowerCase() });

                await batch.commit();
                navigate('/');
            }
        } catch (error) {
            setModalMessage(error.message);
        } finally {
            setLoading(false);
        }
    };

    if (authAction === 'reset') {
        return (
            <div className="flex justify-center items-center mt-10">
                <div className="w-full max-w-md bg-white p-8 rounded-lg shadow-lg">
                    <h2 className="text-3xl font-bold text-center mb-6">Reset Password</h2>
                    <form onSubmit={handlePasswordReset} className="space-y-4">
                        <div>
                            <label className="block text-gray-700 mb-2" htmlFor="emailOrUsername">Email</label>
                            <input type="email" id="emailOrUsername" value={emailOrUsername} onChange={(e) => setEmailOrUsername(e.target.value)} className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${color.ring}`} required />
                        </div>
                        <button type="submit" disabled={loading} className={`w-full h-14 flex justify-center items-center ${color.bg} ${color.hoverBg} text-white font-bold py-3 px-4 rounded-lg disabled:opacity-50 transition-colors mt-6`}>
                            {loading ? <Spinner gameId={activeTab} size="small" /> : 'Send Reset Link'}
                        </button>
                    </form>
                    <p className="text-center mt-4">
                        <button onClick={() => setAuthAction('login')} className={`${color.text} hover:underline`}>
                            Back to Login
                        </button>
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex justify-center items-center mt-10">
            <div className="w-full max-w-md bg-white p-8 rounded-lg shadow-lg">
                <h2 className="text-3xl font-bold text-center mb-6">{authAction === 'login' ? 'Login' : 'Register'}</h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                    {authAction === 'register' && (
                         <div>
                            <label className="block text-gray-700 mb-2" htmlFor="username">Username</label>
                            <input type="text" id="username" value={username} onChange={(e) => setUsername(e.target.value)} className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${color.ring}`} required />
                        </div>
                    )}
                    <div>
                        <label className="block text-gray-700 mb-2" htmlFor="emailOrUsername">{authAction === 'login' ? 'Email or Username' : 'Email'}</label>
                        <input type={authAction === 'login' ? "text" : "email"} id="emailOrUsername" value={emailOrUsername} onChange={(e) => setEmailOrUsername(e.target.value)} className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${color.ring}`} required />
                    </div>
                    <div>
                        <label className="block text-gray-700 mb-2" htmlFor="password">Password</label>
                        <PasswordInput
                            id="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${color.ring}`}
                            required
                        />
                        {authAction === 'register' && <PasswordStrengthIndicator password={password} />}
                    </div>
                    {authAction === 'register' && (
                        <div>
                            <label className="block text-gray-700 mb-2" htmlFor="confirmPassword">Confirm Password</label>
                            <PasswordInput
                                id="confirmPassword"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${color.ring}`}
                                required
                            />
                        </div>
                    )}
                    <button 
                        type="submit" 
                        disabled={loading} 
                        className={`w-full h-14 flex justify-center items-center ${color.bg} ${color.hoverBg} text-white font-bold py-3 px-4 rounded-lg disabled:opacity-50 transition-colors mt-6`}
                    >
                        {loading ? <Spinner gameId={activeTab} size="small" /> : (authAction === 'login' ? 'Login' : 'Register')}
                    </button>
                </form>
                <div className="flex justify-between items-center mt-4">
                    <button onClick={() => setAuthAction(authAction === 'login' ? 'register' : 'login')} className={`${color.text} hover:underline`}>
                        {authAction === 'login' ? "Don't have an account? Register" : 'Already have an account? Login'}
                    </button>
                    {authAction === 'login' && (
                        <button onClick={() => setAuthAction('reset')} className={`${color.text} hover:underline text-sm`}>
                            Forgot Password?
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AuthPage;