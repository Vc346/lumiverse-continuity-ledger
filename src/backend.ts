import { ledgerService, registerLedgerMacro } from "./ledger";

registerLedgerMacro(spindle);
const dispatch = ledgerService(spindle);

spindle.onFrontendMessage(async (request, userId, frontendSessionId) => {
  if (request?.type !== "ledger" || !userId) return;
  let response;
  try {
    response = { data: await dispatch(userId, request) };
  } catch (error) {
    response = { error: error.message || "Ledger request failed." };
  }
  spindle.sendToFrontend(
    { type: "ledger_result", requestId: request.requestId, ...response },
    userId,
    { frontendSessionId },
  );
});
