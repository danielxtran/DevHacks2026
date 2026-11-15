import { createContext } from 'react'

// Keep context identity stable while the provider and its hooks refresh in development.
export const PipelineContext = createContext(null)
