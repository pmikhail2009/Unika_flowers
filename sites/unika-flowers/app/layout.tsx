import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'UNICA & FLOWERS — гортензии с любовью', description: 'Коллекция гортензий, заявки и забота о вашем саде.', icons: { icon: '/assets/logo.png' } };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="ru"><body>{children}</body></html>; }
