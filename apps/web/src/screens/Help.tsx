// Ajuda (T-026, reworked in the review): the questions people ask before trusting a new way to pay, answered in plain words.
// The photo credits live in Conta › Créditos, not here.
import { Button, Icon } from "../design/ds.tsx";
import { navigate } from "../router.ts";
import { Dock, FlowHeader } from "../ui.tsx";

const QUESTIONS: { q: string; a: string }[] = [
  {
    q: "O que é a Vants?",
    a: "Um jeito de pagar qualquer Pix com o dinheiro da sua carteira digital: dólar digital, lumens ou o que você investiu. Você confirma na carteira e o Pix sai em segundos.",
  },
  {
    q: "Meu dinheiro fica com a Vants?",
    a: "Não. Ele fica na sua carteira, sob o seu controle, até o instante do pagamento. A Vants nunca vê as chaves da sua carteira, e nada sai sem a sua confirmação.",
  },
  {
    q: "E se o Pix não sair?",
    a: "O valor volta sozinho para a sua carteira. O comprovante mostra cada etapa, do momento em que você confirma até o Pix cair.",
  },
  {
    q: "O que é dólar digital?",
    a: "Uma moeda digital que vale um dólar americano (o USDC, da Circle). Ela fica na sua carteira e paga Pix: a Vants converte para reais na hora do pagamento.",
  },
  {
    q: "Como funcionam os investimentos?",
    a: "Você coloca dólar digital ou lumens num fundo que empresta para outras pessoas e recebe juros. A taxa muda todo dia, e rendimento passado não garante rendimento futuro. Para resgatar, é só confirmar na carteira.",
  },
  {
    q: "Como coloco dinheiro?",
    a: "Com Pix, em Adicionar dinheiro. A Etherfuse, parceira da Vants, converte seus reais em dólar digital ou em Tesouro e envia direto para a sua carteira.",
  },
  {
    q: "Quanto custa?",
    a: "No modo de teste, nada. Quando houver tarifa, ela aparece antes de você confirmar, nunca depois.",
  },
  {
    q: "O que é o modo de teste?",
    a: "Esta versão funciona na rede de testes da Stellar e no ambiente de testes dos parceiros. Os Pix são simulados e nenhum dinheiro de verdade se move.",
  },
];

export function Help() {
  return (
    <div className="app">
      <FlowHeader title="Ajuda" back={() => (history.length > 1 ? history.back() : navigate({ name: "home" }))} />
      <main className="screen">
        <h1 className="t-title">Perguntas frequentes</h1>
        <div className="panel">
          {QUESTIONS.map(({ q, a }) => (
            <details key={q} className="faq-item">
              <summary>
                <span>{q}</span>
                <Icon name="chevronDown" size={20} className="details-chevron" />
              </summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </main>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="app">
      <main className="screen" style={{ justifyContent: "center", textAlign: "center" }}>
        <h1 className="t-title">Essa página não existe</h1>
        <p className="lede" style={{ marginInline: "auto" }}>
          O endereço pode ter mudado. Seu dinheiro continua onde estava.
        </p>
      </main>
      <Dock>
        <Button size="lg" block onClick={() => navigate({ name: "home" }, { replace: true })}>
          Voltar ao início
        </Button>
      </Dock>
    </div>
  );
}
