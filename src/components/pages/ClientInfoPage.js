import React from 'react';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';

const FeatureCard = ({ icon, iconColor, title, description, badge }) => (
    <div className="group relative p-6 rounded-2xl bg-white border border-gray-100 shadow-sm hover:shadow-lg hover:border-gray-200 transition-all duration-300">
        {badge && (
            <span className="absolute -top-2 -right-2 bg-gradient-to-r from-blue-500 to-indigo-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-md">
                {badge}
            </span>
        )}
        <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${iconColor} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300`}>
            <Icon path={icon} className="w-7 h-7 text-white" />
        </div>
        <h3 className="text-xl font-bold text-gray-800 mb-2">{title}</h3>
        <p className="text-gray-600 leading-relaxed">{description}</p>
    </div>
);

const StepCard = ({ number, title, description }) => (
    <div className="flex items-start space-x-4">
        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold shadow-md">
            {number}
        </div>
        <div>
            <h4 className="font-bold text-gray-800 mb-1">{title}</h4>
            <p className="text-gray-600 text-sm">{description}</p>
        </div>
    </div>
);

const ClientInfoPage = () => {
    return (
        <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
            {/* Hero Section */}
            <div className="relative overflow-hidden bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 text-white">
                <div className="absolute inset-0 opacity-10">
                    <div className="absolute inset-0" style={{
                        backgroundImage: 'radial-gradient(circle at 2px 2px, rgba(255,255,255,0.3) 1px, transparent 0)',
                        backgroundSize: '32px 32px'
                    }}></div>
                </div>
                <div className="container mx-auto max-w-6xl px-6 py-20 relative">
                    <div className="text-center">
                        <div className="inline-flex items-center bg-white/10 backdrop-blur-sm rounded-full px-4 py-2 mb-6">
                            <Icon path={ICONS.desktop} className="w-5 h-5 mr-2" />
                            <span className="text-sm font-medium">Windows Desktop App</span>
                        </div>
                        <h1 className="text-5xl md:text-6xl font-extrabold mb-6 leading-tight">
                            PlanetCreations
                            <span className="block text-blue-200">Client</span>
                        </h1>
                        <p className="text-xl text-blue-100 max-w-2xl mx-auto mb-10 leading-relaxed">
                            Your local management hub for Planet Coaster 2 and Planet Zoo creations.
                            Backup, organize, and share your work with ease.
                        </p>
                        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                            <a
                                href="https://github.com/kutmandur/PlanetCreations/releases"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center bg-white text-indigo-600 font-bold py-4 px-8 rounded-xl hover:bg-blue-50 transition-all duration-300 shadow-lg hover:shadow-xl hover:-translate-y-0.5"
                            >
                                <Icon path={ICONS.download} className="w-6 h-6 mr-3" />
                                Download for Windows
                            </a>
                            <a
                                href="https://github.com/kutmandur/PlanetCreations"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center bg-white/10 backdrop-blur-sm text-white font-semibold py-4 px-8 rounded-xl hover:bg-white/20 transition-all duration-300 border border-white/20"
                            >
                                <Icon path={ICONS.code} className="w-5 h-5 mr-2" />
                                View on GitHub
                            </a>
                        </div>
                    </div>
                </div>
                <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-gray-50 to-transparent"></div>
            </div>

            {/* Features Section */}
            <div className="container mx-auto max-w-6xl px-6 py-20">
                <div className="text-center mb-16">
                    <h2 className="text-3xl md:text-4xl font-bold text-gray-800 mb-4">
                        Everything You Need
                    </h2>
                    <p className="text-gray-600 text-lg max-w-2xl mx-auto">
                        Powerful features designed to help you manage and protect your creative work.
                    </p>
                </div>

                <div className="grid md:grid-cols-2 lg:grid-cols-2 gap-6 mb-16">
                    <FeatureCard
                        icon={ICONS.database}
                        iconColor="from-blue-400 to-blue-600"
                        title="Local Backups"
                        description="Create and manage local backups of your parks and blueprints. One-click backup and restore functionality ensures you never lose your progress."
                    />
                    <FeatureCard
                        icon={ICONS.image}
                        iconColor="from-emerald-400 to-emerald-600"
                        title="Media Management"
                        description="Link your blueprints with custom images, videos, and audio. The client manages these files automatically, keeping everything organized."
                    />
                    <FeatureCard
                        icon={ICONS.shieldCheck}
                        iconColor="from-indigo-400 to-indigo-600"
                        title="Signed Backups"
                        description="Secure your backups with a digital signature. Connect your PlanetCreations.net account to verify authenticity and integrity."
                        badge="Secure"
                    />
                    <FeatureCard
                        icon={ICONS.share}
                        iconColor="from-teal-400 to-teal-600"
                        title="Easy Private Sharing"
                        description="Share creations with friends easily. The client creates linked backup files that include both game data and associated media."
                    />
                </div>

                {/* Offline-First Banner */}
                <div className="bg-gradient-to-r from-gray-800 to-gray-900 rounded-2xl p-8 md:p-12 text-white mb-20">
                    <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                        <div className="flex items-center">
                            <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center mr-6">
                                <Icon path={ICONS.wifi} className="w-8 h-8 text-white" />
                            </div>
                            <div>
                                <h3 className="text-2xl font-bold mb-1">Offline-First Design</h3>
                                <p className="text-gray-300">Works completely offline. Your data stays on your computer.</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                            <div className="flex items-center bg-white/10 rounded-lg px-4 py-2">
                                <Icon path={ICONS.checkCircle} className="w-5 h-5 text-green-400 mr-2" />
                                <span>No internet required</span>
                            </div>
                            <div className="flex items-center bg-white/10 rounded-lg px-4 py-2">
                                <Icon path={ICONS.checkCircle} className="w-5 h-5 text-green-400 mr-2" />
                                <span>Full data control</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* How Sharing Works */}
                <div className="mb-20">
                    <div className="text-center mb-12">
                        <h2 className="text-3xl font-bold text-gray-800 mb-4">How Sharing Works</h2>
                        <p className="text-gray-600 max-w-xl mx-auto">
                            Share your creations privately with friends in just a few simple steps.
                        </p>
                    </div>
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
                        <div className="grid md:grid-cols-3 gap-8">
                            <StepCard
                                number="1"
                                title="Create a Backup"
                                description="Select your creation and click backup. The client generates two linked files: game data + media."
                            />
                            <StepCard
                                number="2"
                                title="Share Both Files"
                                description="Send both backup files to your friend via your preferred method (email, Discord, etc.)."
                            />
                            <StepCard
                                number="3"
                                title="Import & Play"
                                description="Your friend imports the files. The client automatically links everything together."
                            />
                        </div>
                    </div>
                </div>

                {/* Important Notes */}
                <div className="grid md:grid-cols-2 gap-6 mb-20">
                    <div className="bg-amber-50 border border-amber-100 rounded-2xl p-6">
                        <div className="flex items-start">
                            <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center mr-4 flex-shrink-0">
                                <Icon path={ICONS.info} className="w-5 h-5 text-amber-600" />
                            </div>
                            <div>
                                <h4 className="font-bold text-gray-800 mb-2">About Custom Media</h4>
                                <p className="text-gray-600 text-sm">
                                    Custom media files (images, videos, audio) must be manually associated with a creation
                                    by its creator using the Media Manager. This gives you full control over linked files.
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="bg-blue-50 border border-blue-100 rounded-2xl p-6">
                        <div className="flex items-start">
                            <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center mr-4 flex-shrink-0">
                                <Icon path={ICONS.shieldExclamation} className="w-5 h-5 text-blue-600" />
                            </div>
                            <div>
                                <h4 className="font-bold text-gray-800 mb-2">Windows Security Notice</h4>
                                <p className="text-gray-600 text-sm">
                                    Windows SmartScreen may show a warning as the app isn't code-signed yet.
                                    Click "More info" → "Run anyway" to install. The project is open-source on GitHub.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Download CTA */}
                <div className="text-center bg-gradient-to-br from-blue-50 to-indigo-50 rounded-3xl p-12 border border-blue-100">
                    <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center mx-auto mb-6 shadow-lg">
                        <Icon path={ICONS.download} className="w-10 h-10 text-white" />
                    </div>
                    <h2 className="text-3xl font-bold text-gray-800 mb-4">Ready to Get Started?</h2>
                    <p className="text-gray-600 mb-8 max-w-lg mx-auto">
                        Download the PlanetCreations Client and take control of your creations today.
                        Free and open-source.
                    </p>
                    <a
                        href="https://github.com/kutmandur/PlanetCreations/releases"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-bold py-4 px-10 rounded-xl hover:from-blue-600 hover:to-indigo-700 transition-all duration-300 shadow-lg hover:shadow-xl hover:-translate-y-0.5"
                    >
                        <Icon path={ICONS.download} className="w-6 h-6 mr-3" />
                        Download Latest Release
                    </a>
                    <p className="text-gray-500 text-sm mt-4">
                        Available for Windows 10/11
                    </p>
                </div>
            </div>
        </div>
    );
};

export default ClientInfoPage;
