// The app's one photograph (T-031, DEC-049): full screen on the welcome screen only, the moment Vants is for: a hand paying
// with a phone at a café counter, the barista behind it, no face in frame. From Pexels (Pexels license: free use and
// modification, no attribution required; no implied endorsement), downloaded into the app (never hotlinked), cropped so the
// phone sits in the upper half, 1200×1404 JPEG. It sets a mood: no screen names the people or says they use Vants. A
// stand-in until Vants has its own, model-released photography of a Pix QR payment (SPEC Q13). Credited in Conta.
import counterPayment from "./counter-payment.jpg";

export interface Photo {
  src: string;
  width: number;
  height: number;
  alt: string;
  /** Where the subject sits, for object-position. */
  focus: string;
  author: string;
  license: string;
  licenseUrl: string;
  source: string;
}

export const PHOTOS = {
  /** Welcome: a hand paying with a phone at a café counter. */
  welcome: {
    src: counterPayment,
    width: 1200,
    height: 1404,
    alt: "Uma pessoa paga com o celular no balcão de um café",
    focus: "50% 50%",
    author: "Tima Miroshnichenko",
    license: "Licença Pexels",
    licenseUrl: "https://www.pexels.com/license/",
    source: "https://www.pexels.com/photo/person-holding-black-smartphone-on-brown-wooden-table-6545379/",
  },
} satisfies Record<string, Photo>;
