import { useAuth as useClerkAuth, useClerk, useUser } from '@clerk/clerk-react';
import { useEffect, useMemo, useState } from 'react';
import { getCurrentUser, setAuthTokenGetter } from '../lib/api.js';
import { AuthContext } from './AuthContext.jsx';

export default function ClerkBackedAuthProvider({ children }) {
  const { isLoaded, isSignedIn, getToken } = useClerkAuth();
  const { user: clerkUser } = useUser();
  const { signOut } = useClerk();
  const [appUser, setAppUser] = useState(null);
  const [roleLoading, setRoleLoading] = useState(false);
  const [roleError, setRoleError] = useState('');

  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    return () => setAuthTokenGetter(null);
  }, [getToken]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setAppUser(null);
      setRoleLoading(false);
      setRoleError('');
      return;
    }

    setRoleLoading(true);
    setRoleError('');
    getCurrentUser()
      .then((result) => setAppUser(result.user))
      .catch((error) => {
        setAppUser(null);
        setRoleError(error.message);
      })
      .finally(() => setRoleLoading(false));
  }, [clerkUser?.id, isLoaded, isSignedIn]);

  const value = useMemo(() => ({
    user: isSignedIn && clerkUser
      ? {
          id: clerkUser.id,
          primaryEmailAddress: clerkUser.primaryEmailAddress,
          fullName: clerkUser.fullName,
          role: appUser?.role || 'user'
        }
      : null,
    loading: !isLoaded || roleLoading,
    configured: true,
    roleError,
    signOut
  }), [appUser?.role, clerkUser, isLoaded, isSignedIn, roleError, roleLoading, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
