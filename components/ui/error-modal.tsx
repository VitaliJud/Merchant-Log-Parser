import React from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { Button } from './button'

interface ErrorModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  message: string
  type?: 'error' | 'warning'
}

export function ErrorModal({ isOpen, onClose, title, message, type = 'error' }: ErrorModalProps) {
  if (!isOpen) return null

  const bgColor = type === 'error' ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'
  const iconColor = type === 'error' ? 'text-red-500' : 'text-yellow-500'
  const titleColor = type === 'error' ? 'text-red-800' : 'text-yellow-800'
  const messageColor = type === 'error' ? 'text-red-700' : 'text-yellow-700'

  return (
    <div className="fixed top-0 left-0 right-0 z-50 p-4">
      <div className={`max-w-4xl mx-auto border-l-4 rounded-lg shadow-lg ${bgColor} ${type === 'error' ? 'border-l-red-500' : 'border-l-yellow-500'}`}>
        <div className="p-4">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <AlertTriangle className={`h-6 w-6 ${iconColor}`} />
            </div>
            <div className="ml-3 flex-1">
              <h3 className={`text-lg font-semibold ${titleColor}`}>
                {title}
              </h3>
              <div className={`mt-2 text-sm ${messageColor}`}>
                <p className="whitespace-pre-wrap">{message}</p>
              </div>
            </div>
            <div className="flex-shrink-0 ml-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="h-8 w-8 p-0 hover:bg-white/50"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
} 