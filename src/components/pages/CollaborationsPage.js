import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// This page now redirects to the CommunitysPage with Collaborations tab selected
const CollaborationsPage = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Redirect to CommunitysPage - the Collaborations tab will be available there
    navigate('/communitys', { replace: true });
  }, [navigate]);

  return null;
};

export default CollaborationsPage;