import React from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { useTicketStore } from '../../../store';

const LoginScreen = () => {
  const { loginWithGoogle } = useTicketStore();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden bg-gradient-to-br from-slate-50 via-blue-50/40 to-indigo-50/50 dark:from-[#060D17] dark:via-[#0A1020] dark:to-[#0E1828] transition-colors">

      {/* Ambient background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute -top-48 -right-48 w-96 h-96 bg-indigo-200/25 dark:bg-indigo-900/15 rounded-full blur-3xl" />
        <div className="absolute -bottom-48 -left-48 w-96 h-96 bg-blue-200/20 dark:bg-blue-900/12 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-violet-100/15 dark:bg-violet-900/8 rounded-full blur-3xl" />
      </div>

      {/* Card */}
      <div className="relative w-full max-w-sm mx-4 overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800"
           style={{ boxShadow: '0 0 0 1px rgba(0,0,0,0.04), 0 16px 48px rgba(15,23,42,0.14)' }}>

        {/* Top accent gradient bar */}
        <div className="h-[3px] bg-gradient-to-r from-indigo-500 via-blue-500 to-indigo-600" />

        <div className="px-10 py-10">

          {/* Logo */}
          <div className="flex justify-center mb-8">
            <img
              src="https://res.cloudinary.com/diwc3efjb/image/upload/v1766049455/clevertap_vtpmh8.jpg"
              alt="CleverTap Logo"
              className="h-11 rounded-lg"
              style={{ boxShadow: '0 2px 8px rgba(15,23,42,0.10)' }}
            />
          </div>

          {/* Heading */}
          <div className="text-center mb-8">
            <h1 className="text-[22px] font-semibold tracking-tight text-slate-900 dark:text-white leading-snug mb-1.5">
              Customer Success
            </h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed">
              Internal Support Dashboard
            </p>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-7">
            <div className="flex-1 h-px bg-slate-100 dark:bg-slate-800" />
            <span className="text-[11px] text-slate-400 dark:text-slate-600 uppercase tracking-widest font-medium">Sign in</span>
            <div className="flex-1 h-px bg-slate-100 dark:bg-slate-800" />
          </div>

          {/* Google Login */}
          <div className="flex justify-center">
            <GoogleLogin
              onSuccess={credentialResponse => loginWithGoogle(credentialResponse)}
              onError={() => console.log('Login Failed')}
              theme="filled_blue"
              shape="pill"
              size="large"
            />
          </div>

          {/* Footer note */}
          <p className="mt-8 text-center text-[11px] text-slate-400 dark:text-slate-600">
            Restricted to authorized personnel only
          </p>
        </div>
      </div>

      {/* Bottom version / copyright tag */}
      <p className="relative mt-6 text-[11px] text-slate-400 dark:text-slate-600">
        CleverTap Global Support &mdash; Internal Tool
      </p>
    </div>
  );
};

export default LoginScreen;
