import React from 'react';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';

const ClientInfoPage = () => {
    return (
        <div className="container mx-auto max-w-4xl p-8 bg-white rounded-lg shadow-md my-10">
            <h1 className="text-4xl font-bold text-center text-gray-800 mb-4">
                The PlanetCreations Client
            </h1>
            <p className="text-center text-gray-600 text-lg mb-10">
                Your local management hub for all your Planet Coaster 2 and Planet Zoo creations, available exclusively for Windows.
            </p>

            <div className="space-y-12">
                <div>
                    <h2 className="text-3xl font-semibold text-gray-700 border-b pb-3 mb-6 text-center">Key Features</h2>
                    <div className="grid md:grid-cols-2 gap-8">
                        
                        <div className="p-6 rounded-lg bg-gray-50 border text-center">
                            <h3 className="text-xl font-bold mb-2 flex items-center justify-center">
                                <Icon path={ICONS.database} className="w-6 h-6 mr-3 text-blue-500" />
                                Local Backups
                            </h3>
                            <p className="text-gray-600">
                                Create and manage local backups of your parks and blueprints. With just one click, you can create safety copies or restore a previous save. Never lose your progress again.
                            </p>
                        </div>

                        <div className="p-6 rounded-lg bg-gray-50 border text-center">
                            <h3 className="text-xl font-bold mb-2 flex items-center justify-center">
                                <Icon path={ICONS.image} className="w-6 h-6 mr-3 text-green-500" />
                                Media Management
                            </h3>
                            <p className="text-gray-600">
                                Link your blueprints with custom media like images, videos, and audio. The client manages these files for you, ensuring they are always correctly associated.
                            </p>
                        </div>

                        <div className="p-6 rounded-lg bg-gray-50 border text-center">
                            <h3 className="text-xl font-bold mb-2 flex items-center justify-center">
                                <Icon path={ICONS.shieldCheck} className="w-6 h-6 mr-3 text-indigo-500" />
                                Signed Backups
                            </h3>
                            <p className="text-gray-600">
                                Secure your backups with a digital signature. By connecting to your PlanetCreations.net account (requires an internet connection), you can sign your backups to ensure their authenticity and integrity.
                            </p>
                        </div>

                        <div className="p-6 rounded-lg bg-gray-50 border text-center">
                            <h3 className="text-xl font-bold mb-2 flex items-center justify-center">
                                <Icon path={ICONS.share} className="w-6 h-6 mr-3 text-teal-500" />
                                Easy Private Sharing
                            </h3>
                            <p className="text-gray-600">
                                The client creates **two linked backup files**: one for your game file and another for its associated custom media. To share, just send **both backup files** to a friend. When they import them, the client automatically recognizes the link.
                            </p>
                        </div>

                    </div>
                </div>

                <div>
                    <h2 className="text-3xl font-semibold text-gray-700 border-b pb-3 mb-6 text-center">Offline-First</h2>
                    <p className="text-gray-600 mb-4 text-center">
                        The client works completely offline on your computer. All your data and backups remain stored locally, giving you full control at all times. An optional online connection enables features like backup signing and synchronization with your PlanetCreations.net profile.
                    </p>
                </div>

                <div className="text-center border-t pt-8">
                    <p className="text-md text-gray-700 font-semibold">
                        A Note on Custom Media
                    </p>
                    <p className="text-gray-500 mt-2 text-sm max-w-2xl mx-auto">
                        Please be aware that custom media files (images, videos, audio) must be manually associated with a creation by its creator using the client's Media Manager. This ensures that you have full control over which files are linked to your work.
                    </p>
                </div>

                {/* HINZUGEFÜGTER ABSCHNITT */}
                <div className="text-center border-t pt-8">
                    <h3 className="text-md text-gray-700 font-semibold flex items-center justify-center">
                        <Icon path={ICONS.shieldExclamation} className="w-5 h-5 mr-2 text-yellow-500" />
                        A Note on Security & Installation
                    </h3>
                    <p className="text-gray-500 mt-2 text-sm max-w-2xl mx-auto">
                        When you run the installer, Windows Defender SmartScreen may show a security warning. This is because the application is not yet digitally signed with a code signing certificate.
                        <br/><br/>
                        We assure you the application is safe. As a fan-made hobby project, the annual cost for a certificate is not yet feasible, but we plan to add it in the future. The entire project is **open-source**, so you can inspect the code yourself on GitHub.
                        <br/><br/>
                        To install, simply click "More info" on the warning prompt, then click "Run anyway".
                    </p>
                </div>
                
                <div className="text-center bg-blue-50 p-8 rounded-lg">
                    <h2 className="text-3xl font-semibold text-gray-700 mb-4 text-center">Download Now</h2>
                    <p className="text-gray-600 mb-6 text-center">
                        Download the client for Windows from our official GitHub releases page.
                    </p>
                    <a
                        href="https://github.com/kutmandur/PlanetCreations/releases"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-6 rounded-lg transition-colors"
                    >
                        <Icon path={ICONS.download} className="w-6 h-6 mr-3" />
                        Go to Download Page
                    </a>
                </div>
            </div>
        </div>
    );
};

export default ClientInfoPage;