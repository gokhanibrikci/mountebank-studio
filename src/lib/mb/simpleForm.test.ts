import { describe, expect, it } from 'vitest';
import ordersFixture from './__fixtures__/orders-imposters.json';
import { stubFromMb, stubToMb } from './model';
import { fromSimpleForm, toSimpleForm } from './simpleForm';
import type { MbImposter, MbStub } from './types';

/**
 * The plain form is a projection, not a replacement: whatever it cannot express
 * has to survive in `extras` and come back untouched. The fixture holds the
 * awkward cases on purpose — including the not(and(query…)) guard — so the test
 * fails if the friendly editor ever starts flattening real configuration.
 */
describe('simple form keeps realistic stubs intact', () => {
  const stubs = (ordersFixture as { imposters: MbImposter[] }).imposters.flatMap(
    (i) => i.stubs ?? [],
  );
  stubs.forEach((raw, index) => {
    it(`stub #${index}`, () => {
      const strip = <T extends object>(o: T): T => {
        const { _links: _d, ...rest } = o as T & { _links?: unknown };
        return rest as T;
      };
      const clean: MbStub = {
        predicates: (raw.predicates ?? []).map(strip),
        responses: (raw.responses ?? []).map(strip),
      };
      const model = stubFromMb(clean);
      const viaForm = { ...model, predicates: fromSimpleForm(toSimpleForm(model.predicates)) };
      expect(stubToMb(viaForm)).toEqual(clean);
    });
  });
});
