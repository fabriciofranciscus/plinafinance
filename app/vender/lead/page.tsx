/**
 * /vender/lead — rota legada.
 *
 * O cadastro do cedente foi absorvido pelo passo 1 do wizard em `/vender`
 * (flow "Para Cotistas" do CEO). Mantemos a rota redirecionando para não
 * quebrar links antigos.
 */

import { redirect } from 'next/navigation';

export default function LeadPage() {
  redirect('/vender');
}
