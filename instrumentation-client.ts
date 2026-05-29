/**
 * Client instrumentation (Next 16). F-M0-5: registra os forms de lead pra
 * proteção BotID. `initBotId` injeta o challenge invisível no client; o
 * server-check (`checkBotId`) roda nos handlers `/api/{vender,comprar}/lead`.
 */

import { initBotId } from 'botid/client/core';

initBotId({
  protect: [
    { path: '/api/vender/lead', method: 'POST' },
    { path: '/api/comprar/lead', method: 'POST' },
  ],
});
