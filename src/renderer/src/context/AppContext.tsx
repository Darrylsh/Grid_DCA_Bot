import React, { createContext, useContext, ReactNode } from 'react'
import { useAppState, type AppContextType } from '../hooks/useAppState'

const AppContext = createContext<AppContextType | undefined>(undefined)

interface AppProviderProps {
  children: ReactNode
}

export function AppProvider({ children }: AppProviderProps): React.ReactElement {
  const appState = useAppState()
  return <AppContext.Provider value={appState}>{children}</AppContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppContext(): AppContextType {
  const context = useContext(AppContext)
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider')
  }
  return context
}
