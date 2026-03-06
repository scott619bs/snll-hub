import './globals.css'

export const metadata = {
  title: 'SNLL Dark Brown Padres',
  description: 'Team Hub — Minor B Spring 2026',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
