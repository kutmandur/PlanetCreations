import React from 'react';
import logo from '../../assets/logo.png';

const Spinner = ({ gameId }) => {
  return (
    <div className="flex justify-center items-center p-4">
      <img 
        src={logo} 
        alt="Loading..." 
        className="w-32 h-32 animate-grow-shrink"
      />
    </div>
  );
};

export default Spinner;