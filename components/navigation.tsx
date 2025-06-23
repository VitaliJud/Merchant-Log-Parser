"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"
import { Database, BookOpen } from "lucide-react"
import { Button } from "@/components/ui/button"

export function Navigation() {
  const pathname = usePathname()

  const navItems = [
    {
      href: "/",
      label: "Log Viewer",
      icon: Database,
      description: "Analyze and export logs"
    },
    {
      href: "/how-to",
      label: "Documentation",
      icon: BookOpen,
      description: "Setup guides"
    }
  ]

  return (
    <nav className="border-b bg-white shadow-sm">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo/Brand */}
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 text-white p-2 rounded-lg">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-semibold text-lg text-gray-900">Merchant Log Parser</h1>
              <p className="text-xs text-gray-500">Log analysis tool</p>
            </div>
          </div>

          {/* Navigation Links */}
          <div className="flex items-center space-x-1">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.href
              
              return (
                <Link key={item.href} href={item.href}>
                  <Button
                    variant={isActive ? "default" : "ghost"}
                    className={`flex items-center gap-2 h-9 px-3 ${
                      isActive 
                        ? "bg-blue-100 text-blue-700 hover:bg-blue-200" 
                        : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="hidden sm:inline">{item.label}</span>
                  </Button>
                </Link>
              )
            })}
          </div>
        </div>
      </div>
    </nav>
  )
} 