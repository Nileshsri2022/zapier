import MainSection from "@/components/MainSection";
import Image from "next/image";
import HeroImage from "@/public/homepage-hero.avif"

export default function Home() {
  return (
    <MainSection>
      <div className="flex lg:flex-row flex-col lg:gap-10 gap-5 mt-20 lg:px-48 px-10 overflow-hidden">
        <div className="basis-2/3 flex flex-col gap-5 justify-center">
          <h2 className="md:text-7xl text-4xl font-bold">Automate without limits</h2>
          <p className="text-xl font-semibold">Turn chaos into smooth operations by automating workflows yourself—no developers, no IT tickets, no delays. The only limit is your imagination.</p>
        </div>
        <Image 
          className="basis-1/3"
          alt="ZapMate Image"
          width={550}
          height={550}
          src={HeroImage} />
      </div>
    </MainSection>
  );
}
