// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BankingScreen } from '../_components/screens/banking';
import { parseCpf } from '@/lib/format/parse-cpf';

// I2 (🟡): o campo de CPF do cadastro Pix tinha maxLength=11 e o onChange tirava a máscara DEPOIS. Colar "529.982.247-25" era
// cortado pelo navegador em "529.982.247" (9 dígitos) antes do onChange, e o CPF ficava inválido. A regra certa: tirar tudo que
// não é dígito e só então limitar a 11. Só entrada: a validação do servidor (parseCpf) não muda.
afterEach(cleanup);

function Casa({ onCpf }: { onCpf?: (v: string) => void }) {
  const [cpf, setCpf] = useState('');
  const [txt, setTxt] = useState('');
  return (
    <BankingScreen
      bankInfo={null}
      pixKey={txt}
      setPixKey={setTxt}
      pixKeyType="cpf"
      setPixKeyType={() => {}}
      firstName="Nome"
      setFirstName={() => {}}
      lastName="Sobrenome"
      setLastName={() => {}}
      cpf={cpf}
      setCpf={(v) => {
        onCpf?.(v);
        setCpf(v);
      }}
      loading={false}
      onSubmit={() => {}}
      onSkip={() => {}}
    />
  );
}
const campo = () => screen.getByPlaceholderText('52998224725') as HTMLInputElement;
const colar = (v: string) => fireEvent.change(campo(), { target: { value: v } });

describe('CPF do cadastro Pix aceita colar com máscara', () => {
  it('"529.982.247-25" colado vira os 11 dígitos, e esse CPF é válido', () => {
    render(<Casa />);
    colar('529.982.247-25');
    expect(campo().value).toBe('52998224725');
    expect(parseCpf(campo().value)).toBe('52998224725');
  });

  it('o navegador não pode cortar a colagem antes do onChange: o campo não tem maxLength', () => {
    render(<Casa />);
    expect(campo().hasAttribute('maxlength')).toBe(false);
  });

  it('formatos comuns de colagem: com espaços, pontos, traço, ou só dígitos', () => {
    for (const v of [' 529.982.247-25 ', '529 982 247 25', '52998224725', '529.982.247/25']) {
      cleanup();
      render(<Casa />);
      colar(v);
      expect(campo().value, JSON.stringify(v)).toBe('52998224725');
    }
  });

  it('mais de 11 dígitos continua limitado a 11 (nada além do CPF entra no estado)', () => {
    const vistos: string[] = [];
    render(<Casa onCpf={(v) => vistos.push(v)} />);
    colar('529.982.247-25 999');
    expect(campo().value).toBe('52998224725');
    expect(vistos.every((v) => v.length <= 11)).toBe(true);
  });

  it('letras e símbolos são descartados', () => {
    render(<Casa />);
    colar('abc529.98x2.247-25');
    expect(campo().value).toBe('52998224725');
  });
});
