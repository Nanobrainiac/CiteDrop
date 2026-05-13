import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth as useClerkAuth, useClerk, useUser } from '@clerk/clerk-react';
import { getCurrentUser, setAuthTokenGetter } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children, clerkEnabled = false }) {
  if (!clerkEnabled) {
    return (
      <AuthContext.Provider value={{ user: null, loading: false, configured: false, signOut: () => {} }}>
        {children}
      </AuthContext.Provider>
    );
  }

  return <ClerkBackedAuthProvider>{children}</ClerkBackedAuthProvider>;
}

function ClerkBackedAuthProvider({ children }) {
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

export function useAuth() {
  return useContext(AuthContext);
}
