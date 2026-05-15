/* Linkedin and Twitter were removed from lucide-react v0.500+ */

export default function Footer() {
  return (
    <footer className="bg-lightBg border-t border-light-hairline py-20 px-6">
      <div className="max-w-7xl mx-auto flex flex-col lg:flex-row justify-between gap-16 reveal">
        <div className="max-w-sm">
          <span className="font-title font-bold text-3xl text-base mb-8 block">
            Plina<span className="text-primary">.</span>
          </span>
          <p className="font-text text-base/70 leading-relaxed font-light">
            Conectando o crédito brasileiro ao capital global por meio de infraestrutura digital regulada.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-16 lg:gap-32">
          <div>
            <h4 className="font-details text-xs font-bold uppercase tracking-widest text-base/60 mb-8">
              Navegação
            </h4>
            <ul className="font-text text-lg font-light space-y-4 text-base/70">
              <li><a href="#produto" className="hover:text-primary transition-colors">Produto</a></li>
              <li><a href="#tese" className="hover:text-primary transition-colors">Tese</a></li>
              <li><a href="#compliance" className="hover:text-primary transition-colors">Compliance</a></li>
              <li><a href="#equipe" className="hover:text-primary transition-colors">Equipe</a></li>
              <li><a href="#lead-capture" className="hover:text-primary transition-colors">Solicitar Prospecto</a></li>
            </ul>
          </div>
          <div>
            <h4 className="font-details text-xs font-bold uppercase tracking-widest text-base/60 mb-8">
              Contato
            </h4>
            <a href="mailto:contato@plina.finance" className="font-mono text-sm text-base/70 hover:text-primary transition-colors block mb-6">
              contato@plina.finance
            </a>
            <p className="font-text text-xs text-base/60 max-w-[300px] leading-relaxed">
              A Plina Finance não é uma corretora. Atua como estruturadora de ativos digitais regulados sob o framework da CVM 175.
            </p>
          </div>
        </div>
      </div>
      <div className="max-w-7xl mx-auto pt-16 mt-16 border-t border-light-hairline flex flex-col md:flex-row justify-between items-center gap-8 opacity-40">
        <p className="font-details text-[10px] font-bold uppercase tracking-[0.2em]">
          &copy; 2026 Plina Finance. Todos os direitos reservados.
        </p>
        <div className="flex gap-6">
          <a href="#" aria-label="LinkedIn" className="cursor-pointer hover:text-primary">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>
          </a>
          <a href="#" aria-label="Twitter / X" className="cursor-pointer hover:text-primary">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          </a>
        </div>
      </div>
    </footer>
  );
}
