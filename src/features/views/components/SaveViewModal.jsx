/**
 * "Save Current View" dialog — names the active filter set so it can be
 * recalled from the Vistas sidebar.
 *
 * Extracted from App.jsx's JSX. Renders nothing when `open` is false, so the
 * call site is a plain element rather than a conditional block.
 */
import { Save } from "lucide-react";

const SaveViewModal = ({ open, name, onNameChange, onCancel, onSave }) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl p-6 w-96 border border-slate-200 dark:border-slate-800">
        <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
          <Save className="w-5 h-5 text-indigo-500" /> Save Current View
        </h3>
        <input
          type="text"
          placeholder="Enter view name..."
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          className="w-full px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-4"
          autoFocus
        />
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={!name.trim()}
            className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save View
          </button>
        </div>
      </div>
    </div>
  );
};

export default SaveViewModal;
