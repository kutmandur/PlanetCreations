import React from 'react';
import Icon from './Icon';
import { ICONS } from '../../utils/helpers';

const InfoBox = () => {
    return (
        <a 
            href="https://postimages.org/" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="mt-2 bg-blue-50 dark:bg-blue-950/40 border-l-4 border-blue-400 dark:border-blue-500 p-3 rounded-r-lg block hover:bg-blue-100 dark:hover:bg-blue-950/60 transition-colors text-sm"
        >
            <div className="flex items-center">
                <div className="flex-shrink-0">
                    <Icon path={ICONS.infoCircle} className="h-5 w-5 text-blue-400" />
                </div>
                <div className="ml-3 flex-1">
                    <p className="text-blue-700 dark:text-blue-200">
                        We recommend <strong className="font-bold">Postimages.org</strong> for image hosting. After uploading, please copy the <strong className="font-bold">"Direct Link"</strong>.
                    </p>
                </div>
            </div>
        </a>
    );
};

export default InfoBox;
