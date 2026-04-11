import { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
  hover?: boolean
}

export default function Card({ children, className = '', hover = false }: CardProps) {
  return (
    <div className={`
      bg-white border border-slate-100 rounded-[2rem] shadow-sm
      ${hover ? 'hover:shadow-md hover:border-pink-100 transition-all duration-300' : ''}
      ${className}
    `}>
      {children}
    </div>
  )
}