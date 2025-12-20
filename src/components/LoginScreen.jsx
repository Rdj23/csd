import React from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { useTicketStore } from '../store';

const LoginScreen = () => {
  const { loginWithGoogle } = useTicketStore();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-[#0B1120] transition-colors">
      <div className="bg-white dark:bg-slate-900 p-10 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 text-center max-w-md w-full">
        <img src="https://res.cloudinary.com/diwc3efjb/image/upload/v1766049455/clevertap_vtpmh8.jpg" alt="Logo" className="h-16 mx-auto mb-6 rounded-lg shadow-sm" />
        
        <h1 className="text-2xl font-bold text-slate-800 dark:text-white mb-2">Customer Success</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-8">
          Internal Support Dashboard<br/>Please sign in with your organizational email.
        </p>

        <div className="flex justify-center">
          <GoogleLogin
            onSuccess={credentialResponse => loginWithGoogle(credentialResponse)}
            onError={() => console.log('Login Failed')}
            theme="filled_blue"
            shape="pill"
            size="large"
          />
        </div>
        
        <p className="mt-8 text-[10px] text-slate-400">
          Authorized personnel only.
        </p>
      </div>
    </div>
  );
};

export default LoginScreen;