import AppShell from '../layout/AppShell'

interface Props {
  title: string
  children: React.ReactNode
}

export default function AdminPageShell({ title, children }: Props) {
  return (
    <AppShell title={title}>
      <div style={{ maxWidth: 1100, padding: '28px 32px' }}>
        {children}
      </div>
    </AppShell>
  )
}
