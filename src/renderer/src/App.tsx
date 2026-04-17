import React, { useEffect } from 'react'
import { Activity } from 'lucide-react'

import { Sidebar } from '@renderer/components/layout/Sidebar'
import { Header } from '@renderer/components/layout/Header'
import { DashboardTab } from '@renderer/components/tabs/DashboardTab'
import { BacktestTab } from '@renderer/components/tabs/BacktestTab'
import { ReportsTab } from '@renderer/components/tabs/ReportsTab'
import { SettingsTab } from '@renderer/components/tabs/SettingsTab'
import { Toast } from '@renderer/components/shared/Toast'
import { ErrorBoundary } from '@renderer/components/shared/ErrorBoundary'
import { useAppContext } from '@renderer/context/AppContext'

export default function App(): React.ReactElement {
  const { isConnected, toast, setToast, activeTab } = useAppContext()

  // Toast auto‑dismiss
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000)
      return () => clearTimeout(t)
    }
    return () => {}
  }, [toast, setToast])

  return (
    <div className="flex h-screen w-full bg-slate-900 text-slate-100 overflow-hidden font-sans">
      {!isConnected && (
        <div className="absolute top-0 left-0 w-full bg-rose-600 font-bold text-white text-center text-xs py-1.5 z-50 shadow-lg shadow-rose-900/50 flex items-center justify-center gap-2 animate-pulse">
          <Activity size={14} /> DISCONNECTED FROM HEADLESS SERVER (192.168.10.42:3030) — Dashboard
          out of sync. Action buttons are disabled.
        </div>
      )}
      <Sidebar />
      <main
        className={`flex-1 flex flex-col h-full bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-slate-800 via-slate-900 to-slate-900 p-8 overflow-y-auto ${!isConnected ? 'opacity-80 pointer-events-none' : ''}`}
      >
        <Header />
        <div className="flex-1 overflow-hidden w-full px-4 pt-4 flex flex-col min-h-0">
          {activeTab === 'dashboard' && (
            <div className="flex-1 flex flex-col min-h-0">
              <ErrorBoundary
                fallback={
                  <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-8 text-center">
                    <div className="text-rose-400 text-lg font-semibold mb-2">Dashboard Error</div>
                    <p className="text-slate-400 mb-4">
                      The dashboard encountered an error. Try switching tabs or reloading.
                    </p>
                    <button
                      onClick={() => window.location.reload()}
                      className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg"
                    >
                      Reload Page
                    </button>
                  </div>
                }
              >
                <DashboardTab />
              </ErrorBoundary>
            </div>
          )}
          {activeTab === 'backtest' && (
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              <ErrorBoundary
                fallback={
                  <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-8 text-center">
                    <div className="text-rose-400 text-lg font-semibold mb-2">Backtest Error</div>
                    <p className="text-slate-400 mb-4">
                      The backtest lab encountered an error. Try switching tabs or reloading.
                    </p>
                    <button
                      onClick={() => window.location.reload()}
                      className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg"
                    >
                      Reload Page
                    </button>
                  </div>
                }
              >
                <BacktestTab />
              </ErrorBoundary>
            </div>
          )}
          {activeTab === 'reports' && (
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              <ErrorBoundary
                fallback={
                  <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-8 text-center">
                    <div className="text-rose-400 text-lg font-semibold mb-2">Reports Error</div>
                    <p className="text-slate-400 mb-4">
                      The reports tab encountered an error. Try switching tabs or reloading.
                    </p>
                    <button
                      onClick={() => window.location.reload()}
                      className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg"
                    >
                      Reload Page
                    </button>
                  </div>
                }
              >
                <ReportsTab />
              </ErrorBoundary>
            </div>
          )}
          {activeTab === 'settings' && (
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              <ErrorBoundary
                fallback={
                  <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-8 text-center">
                    <div className="text-rose-400 text-lg font-semibold mb-2">Settings Error</div>
                    <p className="text-slate-400 mb-4">
                      The settings tab encountered an error. Try switching tabs or reloading.
                    </p>
                    <button
                      onClick={() => window.location.reload()}
                      className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg"
                    >
                      Reload Page
                    </button>
                  </div>
                }
              >
                <SettingsTab />
              </ErrorBoundary>
            </div>
          )}
        </div>
      </main>
      <Toast toast={toast} />
    </div>
  )
}
