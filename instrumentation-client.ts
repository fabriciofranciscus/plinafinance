/**
 * Client instrumentation (Next 16). F-M0-5: registra os forms de lead pra
 * proteção BotID. `initBotId` injeta o challenge invisível no client; o
 * server-check (`checkBotId`) roda nos handlers `/api/{vender,comprar}/lead`.
 */

import { initBotId } from 'botid/client/core';
import { botIdProtegidos } from '@/lib/http/botid-rotas';

// Hotfix 14/11 (Atlas; B1 do Argus): /api/comprar/lead (anônima) SEMPRE protegida; /api/vender/lead (login + KYC) só sai da
// lista com NEXT_PUBLIC_BOTID_ENFORCE === 'false' exato (lida no BUILD: mudar em Production exige REDEPLOY). Mesma lista do
// BotIdClient do app/layout.tsx — os dois pontos patcham o fetch e têm de concordar.
initBotId({ protect: botIdProtegidos(process.env.NEXT_PUBLIC_BOTID_ENFORCE) });
