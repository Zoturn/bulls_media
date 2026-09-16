import { redirect } from 'next/navigation';

/** The only real page this product has is the console; `/` exists so a bare visit lands there. */
export default function Home() {
  redirect('/console');
}
