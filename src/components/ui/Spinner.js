import React from 'react';

const Spinner = ({ gameId }) => {
  return (
    <div className="flex justify-center items-center p-4">
      <img 
        src="/logo.png" 
        alt="Loading..." 
        className="w-32 h-32 animate-grow-shrink" // Changed from animate-pulse
      />
    </div>
  );
};

export default Spinner;