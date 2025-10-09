import React from 'react';
import { Link } from 'react-router-dom';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';

const CollaborationsPage = () => {
  const isRunningInElectron = window.electronAPI?.isElectron;

  if (isRunningInElectron) {
    // Diese Ansicht wird in der Electron-App angezeigt
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <Icon path={ICONS.users} className="w-24 h-24 text-gray-300 mb-6" />
        <h1 className="text-5xl font-bold text-gray-700">Collaborations</h1>
        <p className="text-2xl text-gray-500 mt-4">Coming Soon!</p>
        <p className="mt-2 text-gray-400">This feature is currently under development.</p>
      </div>
    );
  }

  // Diese Ansicht wird im Web-Browser angezeigt
  return (
    <div className="flex items-center justify-center h-full p-4">
      <div className="max-w-2xl w-full bg-white p-10 rounded-xl shadow-lg text-center border">
        <Icon path={ICONS.desktopComputer} className="w-20 h-20 mx-auto text-blue-500 mb-4" />
        <h1 className="text-3xl font-bold text-gray-800 mb-2">
          This Feature is Client-Exclusive
        </h1>
        <p className="text-gray-600 mb-6">
          The collaborations feature, including private workspaces and direct sharing, is only available in the PlanetCreations desktop client.
        </p>
        <Link 
          to="/client-info"
          className="inline-flex items-center bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-6 rounded-lg transition-colors"
        >
          <Icon path={ICONS.download} className="w-5 h-5 mr-3" />
          Learn More About the Client
        </Link>
      </div>
    </div>
  );
};

export default CollaborationsPage;