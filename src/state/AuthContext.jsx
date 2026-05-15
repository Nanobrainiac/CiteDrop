import { createContext, useContext } from 'react';

export const AuthContext = createContext(null);

export function AuthProvider({ children, configured = false }) {
  return (
    <AuthContext.Provider value={{ user: null, loading: false, configured, signOut: () => {} }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
