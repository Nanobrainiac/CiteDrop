import { ClerkProvider } from '@clerk/clerk-react';
import { AuthProvider } from '../state/AuthContext.jsx';
import ClerkBackedAuthProvider from '../state/ClerkBackedAuthProvider.jsx';

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

export default function ClerkRuntime({ children }) {
  if (!clerkPublishableKey) {
    return <AuthProvider configured={false}>{children}</AuthProvider>;
  }

  return (
    <ClerkProvider publishableKey={clerkPublishableKey}>
      <ClerkBackedAuthProvider>{children}</ClerkBackedAuthProvider>
    </ClerkProvider>
  );
}
