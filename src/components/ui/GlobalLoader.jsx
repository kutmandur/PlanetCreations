import React from 'react';
import Spinner from './Spinner';

const GlobalLoader = ({ message }) => (
    <div className="fixed inset-0 bg-black/60 flex flex-col items-center justify-center z-[100]">
        <Spinner />
        {message && <p className="text-white text-lg mt-4 font-semibold">{message}</p>}
    </div>
);

export default GlobalLoader;
