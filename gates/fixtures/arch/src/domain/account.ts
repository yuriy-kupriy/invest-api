// HW #32 demo:gates, step "arch", broken input: the pure domain layer reaching
// into a feature module's HTTP edge. dependency-cruiser must reject it twice
// (domain-stays-pure, no-foreign-edge).
import { AccountsController } from '../accounts/accounts.controller';
export const edge = AccountsController;
