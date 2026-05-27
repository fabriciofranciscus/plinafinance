import { GLOSSARY } from '../../_lib/glossary';

export function Term({ children }: { children: keyof typeof GLOSSARY | string }) {
  const key = typeof children === 'string' ? children : (children as string);
  const def = GLOSSARY[key];
  if (!def) return <>{children}</>;
  return (
    <abbr
      title={def}
      className="cursor-help no-underline border-b border-dotted border-primary-deep/60 hover:border-primary-deep transition-colors"
    >
      {children}
    </abbr>
  );
}
