/**
 * The single transient confirmation toast (bottom-centre).
 *
 * Extracted from App.jsx. Renders nothing when `message` is falsy, which is
 * exactly how the inline version behaved.
 */
const Toast = ({ message }) => {
  if (!message) return null;

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-5 py-2.5 rounded-full flex items-center gap-2 text-[12px] font-semibold animate-fade-in"
         style={{ boxShadow: '0 4px 24px rgba(15,23,42,0.25), 0 1px 4px rgba(15,23,42,0.15)' }}>
      {message}
    </div>
  );
};

export default Toast;
