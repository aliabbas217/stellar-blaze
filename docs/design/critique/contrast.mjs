const oklch2srgb=(L,C,h)=>{const a=C*Math.cos(h*Math.PI/180),b=C*Math.sin(h*Math.PI/180);
let l_=L+0.3963377774*a+0.2158037573*b,m_=L-0.1055613458*a-0.0638541728*b,s_=L-0.0894841775*a-1.2914855480*b;
let l=l_**3,m=m_**3,s=s_**3;
let r=4.0767416621*l-3.3077115913*m+0.2309699292*s,g=-1.2684380046*l+2.6097574011*m-0.3413193965*s,bb=-0.0041960863*l-0.7034186147*m+1.7076147010*s;
const enc=x=>{x=Math.min(1,Math.max(0,x));return x<=0.0031308?12.92*x:1.055*x**(1/2.4)-0.055};
return [r,g,bb].map(x=>Math.round(enc(x)*255));};
const lum=([r,g,b])=>{const f=c=>{c/=255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b)};
const cr=(x,y)=>{const a=lum(x),b=lum(y);return ((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)).toFixed(2)};
const P=s=>{const [L,C,h]=s.split(' ').map(Number);return oklch2srgb(L,C,h)};
const hex=c=>'#'+c.map(x=>x.toString(16).padStart(2,'0')).join('');
const T={sand50:'0.975 0.012 80',sand100:'0.95 0.02 80',sand300:'0.83 0.04 76',sand500:'0.6 0.045 70',sand700:'0.42 0.035 65',sand900:'0.24 0.02 60',sand950:'0.17 0.015 60',
falaj300:'0.8 0.08 198',falaj600:'0.5 0.08 205',falaj700:'0.42 0.07 208',green:'0.52 0.13 150',amber:'0.82 0.16 85',orange:'0.7 0.17 50',red:'0.5 0.19 27',white:'1 0 0',
red55:'0.55 0.19 27',red56:'0.56 0.19 27',falajSoft:'0.93 0.03 205',falajDark:'0.3 0.04 205', sand200:'0.9 0.03 78'};
for(const k in T) console.log(k,hex(P(T[k])));
const pairs=[['red','sand950'],['red','sand900'],['red','sand50'],['amber','sand50'],['orange','sand50'],['green','sand950'],
['sand950','sand50'],['sand50','sand950'],['sand50','red'],['sand950','amber'],['sand50','sand900'],['sand950','sand100'],
['sand700','sand50'],['sand700','sand100'],['sand700','sand200'],['falaj600','sand50'],['falaj600','sand100'],['falaj300','sand950'],['falaj300','sand900'],['sand300','sand950'],
['sand500','sand50'],['sand500','sand950'],['falaj700','falajSoft'],['sand50','falajDark'],['sand700','sand300'],['sand950','sand300'],['white','red'],['white','green'],['white','falaj600'],['falaj700','sand50'],['falaj300','sand50'],['sand50','green'],['sand950','orange']];
for(const [a,b] of pairs) console.log(a,'on',b,cr(P(T[a]),P(T[b])));
