import type {Metadata,Viewport} from 'next';
import {Manrope} from 'next/font/google';
import './globals.css';
const manrope=Manrope({subsets:['cyrillic','latin'],display:'swap',variable:'--font-manrope',fallback:['Segoe UI','Arial','sans-serif']});
export const metadata:Metadata={title:'DZ LAB — конфигуратор ПК и цены комплектующих',description:'Каталог реальных комплектующих, цены из магазинов, проверка совместимости и сохранение сборок.',metadataBase:new URL('https://dz-lab-performance-dima.ardentglade35.chatgpt.site'),openGraph:{type:'website',locale:'ru_RU',siteName:'DZ LAB',title:'DZ LAB — собери свой ПК',description:'Выбирай комплектующие, сравнивай цены магазинов и настраивай готовые сборки.',images:[{url:'/images/hero-pc.webp',width:1536,height:1024,alt:'Компьютер DZ LAB'}]},icons:{icon:'/favicon.svg'}};
export const viewport:Viewport={themeColor:'#0f131b',width:'device-width',initialScale:1};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="ru" className={manrope.variable}><body>{children}</body></html>}
