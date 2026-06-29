import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth/admin';

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const leads = await db.leadEoi.findMany({
    orderBy: { criadoEm: 'desc' },
  });

  const header = [
    'ID', 'Data', 'Nome', 'Organização', 'E-mail', 'Telefone',
    'Perfil', 'Jurisdição', 'Tíquete', 'Moeda', 'Classe', 'Prazo',
    'Observações', 'Status',
  ];

  function cell(v: string | null | undefined) {
    return `"${(v ?? '').replace(/"/g, '""')}"`;
  }

  const rows = leads.map((l) =>
    [
      l.id,
      l.criadoEm.toISOString(),
      l.nome,
      l.org,
      l.email,
      l.telefone,
      l.perfil,
      l.jurisdiction,
      l.ticket,
      l.currency,
      l.classe,
      l.timeline,
      l.notes,
      l.status,
    ].map(cell).join(',')
  );

  const csv = [header.map(cell).join(','), ...rows].join('\r\n');
  const date = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="leads-eoi-${date}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
