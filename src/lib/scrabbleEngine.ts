// ─── Scrabble Engine ─────────────────────────────────────────────────────────
// Board: 15x15 = 225 chars. '.' = empty, uppercase = placed tile, lowercase = placed-this-turn

// ── Tile values ──────────────────────────────────────────────────────────────

export const TILE_VALUES: Record<string, number> = {
  A:1, B:3, C:3, D:2, E:1, F:4, G:2, H:4, I:1, J:8, K:5, L:1, M:3,
  N:1, O:1, P:3, Q:10, R:1, S:1, T:1, U:1, V:4, W:4, X:8, Y:4, Z:10, _:0,
};

// ── Tile distribution (100 tiles total) ──────────────────────────────────────

const TILE_DIST = 'AAAAAAAAABBCCDDDDEEEEEEEEEEEEFFGGGHHIIIIIIIIIJKLLLLMMNNNNNNOOOOOOOOPPQRRRRRRSSSSTTTTTTUUUUVVWWXYYZ__';

export function createTileBag(): string {
  const arr = TILE_DIST.split('');
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join('');
}

export function drawTiles(bag: string, count: number): { drawn: string; remaining: string } {
  const n = Math.min(count, bag.length);
  return { drawn: bag.slice(0, n), remaining: bag.slice(n) };
}

// ── Board multipliers ────────────────────────────────────────────────────────
// 0=normal, 1=DL, 2=TL, 3=DW, 4=TW, 5=center(DW)

const MULT_MAP = (() => {
  const m = new Uint8Array(225);
  // Triple Word
  const tw = [[0,0],[0,7],[0,14],[7,0],[7,14],[14,0],[14,7],[14,14]];
  tw.forEach(([r,c]) => m[r*15+c] = 4);
  // Double Word
  const dw = [[1,1],[2,2],[3,3],[4,4],[1,13],[2,12],[3,11],[4,10],
              [13,1],[12,2],[11,3],[10,4],[13,13],[12,12],[11,11],[10,10]];
  dw.forEach(([r,c]) => m[r*15+c] = 3);
  // Center
  m[7*15+7] = 5;
  // Triple Letter
  const tl = [[1,5],[1,9],[5,1],[5,5],[5,9],[5,13],
              [9,1],[9,5],[9,9],[9,13],[13,5],[13,9]];
  tl.forEach(([r,c]) => m[r*15+c] = 2);
  // Double Letter
  const dl = [[0,3],[0,11],[2,6],[2,8],[3,0],[3,7],[3,14],
              [6,2],[6,6],[6,8],[6,12],[7,3],[7,11],
              [8,2],[8,6],[8,8],[8,12],[11,0],[11,7],[11,14],
              [12,6],[12,8],[14,3],[14,11]];
  dl.forEach(([r,c]) => m[r*15+c] = 1);
  return m;
})();

export function getMultiplier(r: number, c: number): number {
  return MULT_MAP[r * 15 + c];
}

export const MULT_LABELS: Record<number, string> = { 0: '', 1: 'DL', 2: 'TL', 3: 'DW', 4: 'TW', 5: '*' };
export const MULT_COLORS: Record<number, string> = {
  0: '#1a1a2e', 1: '#1e3a5f', 2: '#1e4d3d', 3: '#4a1942', 4: '#6b1a1a', 5: '#4a1942',
};
export const MULT_BG: Record<number, string> = {
  0: '#0d1117', 1: '#1e3a5f', 2: '#0d4a3a', 3: '#3d1240', 4: '#5c1515', 5: '#3d1240',
};

// ── Board helpers ────────────────────────────────────────────────────────────

export const EMPTY_BOARD = '.'.repeat(225);

export function getCell(board: string, r: number, c: number): string {
  if (r < 0 || r >= 15 || c < 0 || c >= 15) return '';
  return board[r * 15 + c];
}

export function setCell(board: string, r: number, c: number, ch: string): string {
  const i = r * 15 + c;
  return board.substring(0, i) + ch + board.substring(i + 1);
}

export function isOccupied(board: string, r: number, c: number): boolean {
  const ch = getCell(board, r, c);
  return ch !== '.' && ch !== '';
}

// ── Word dictionary ──────────────────────────────────────────────────────────
// Compact set of common 2-7 letter English words valid for word games.

const WORD_DATA = `AA AB AD AE AG AH AI AL AM AN AR AS AT AW AX AY BA BE BI BO BY DA DE DO ED EF EH EL EM EN ER ES ET EX FA FE GO HA HE HI HM HO ID IF IN IS IT JO KA KI LA LI LO MA ME MI MM MO MU MY NA NE NO NU OD OE OF OH OI OK OM ON OP OR OS OW OX OY PA PE PI PO QI RE SH SI SO TA TI TO UH UM UN UP US UT WE WO XI XU YA YE YO ZA
AAH AAL AAS ABA ABO ABS ABY ACE ACT ADD ADO ADS ADZ AFT AGA AGE AGO AGS AHA AHI AHS AID AIM AIN AIR AIS AIT ALA ALB ALE ALL ALP ALS ALT AMA AMI AMP AMU ANA AND ANE ANI ANT ANY APE APO APP APT ARB ARC ARE ARF ARK ARM ARS ART ASH ASK ASP ASS ATE ATT AUK AVA AVE AVO AWA AWE AWL AWN AXE AYS AZO
BAA BAD BAG BAH BAM BAN BAP BAR BAS BAT BAY BED BEE BEG BEL BEN BES BET BEY BIB BID BIG BIN BIS BIT BIZ BOA BOB BOD BOG BOP BOS BOT BOW BOX BOY BRA BRO BRR BUB BUD BUG BUM BUN BUR BUS BUT BUY
CAB CAD CAM CAN CAP CAR CAT CAW CEE CEL CEP CHI CIG CIS COB COD COG COL CON COO COP COR COS COT COW COX COY COZ CRU CRY CUB CUD CUE CUP CUR CUT CWM
DAB DAD DAG DAH DAK DAL DAM DAP DAW DAY DEB DEE DEL DEN DEV DEW DEX DEY DIB DID DIE DIF DIG DIM DIN DIP DIS DIT DOC DOE DOG DOL DON DOP DOR DOS DOT DOW DRY DUB DUD DUE DUG DUH DUN DUO DUP DYE
EAR EAT EAU EEL EEK EGG EGO EKE ELD ELF ELK ELL ELM EME EMS EMU END ENG ERA ERE ERG ERN ERR ERS ESS ETA ETH EVE EWE EYE
FAB FAD FAN FAR FAT FAX FAY FED FEE FEH FEM FEN FER FES FET FEU FEW FEY FEZ FIB FID FIE FIG FIN FIR FIS FIT FIX FIZ FLU FLY FOB FOE FOG FOH FON FOP FOR FOU FOX FOY FRO FRY FUB FUG FUN FUR
GAB GAD GAE GAG GAL GAM GAN GAP GAR GAS GAT GAY GED GEE GEL GEM GEN GET GEY GHI GIB GID GIE GIG GIN GIP GIT GNU GOA GOB GOD GOR GOS GOT GOX GUL GUM GUN GUP GUS GUT GUV GUY GYM GYP
HAD HAE HAG HAH HAJ HAM HAO HAP HAS HAT HAW HAY HEH HEM HEN HEP HER HES HET HEW HEX HEY HIC HID HIE HIM HIN HIP HIS HIT HOB HOD HOE HOG HOP HOT HOW HOY HUB HUE HUG HUH HUM HUN HUP HUT HYP
ICE ICH ICK ICY IDS IFF IFS IGG ILL IMP INK INN INS ION IRE IRK ISM ITS IVY
JAB JAG JAM JAR JAW JAY JEE JET JIB JIG JIN JOB JOE JOG JOT JOW JOY JUG JUN JUS JUT
KAB KAE KAF KAS KAT KAY KEA KED KEG KEN KEP KEX KEY KHI KID KIN KIP KIR KIS KIT
LAB LAC LAD LAG LAM LAP LAS LAT LAV LAW LAX LAY LEA LED LEE LEG LEI LET LEU LEV LEX LEY LIB LID LIE LIN LIP LIS LIT LOG LOO LOP LOT LOW LOX LUG LUV LYE
MAC MAD MAE MAG MAN MAP MAR MAS MAT MAW MAX MAY MED MEL MEM MEN MET MEW MID MIG MIL MIM MIR MIS MIX MOA MOB MOC MOD MOG MOL MOM MON MOP MOR MOS MOT MOW MUD MUG MUM MUN MUS MUT MYC
NAB NAE NAG NAH NAM NAN NAP NAW NAY NEE NET NEW NIB NIL NIM NIP NIT NIX NOB NOD NOG NOM NOO NOR NOS NOT NOW NTH NUB NUN NUS NUT
OAF OAK OAR OAT OBE OBI OCA ODD ODE ODS OES OFF OFT OHM OHO OHS OIL OKA OKE OLD OLE OMS ONE ONO ONS OOH OOT OPE OPS OPT ORA ORB ORC ORE ORS ORT OSE OUD OUR OUT OVA OWE OWL OWN OXO OXY
PAC PAD PAH PAL PAM PAN PAP PAR PAS PAT PAW PAX PAY PEA PEC PED PEE PEG PEH PEN PEP PER PES PET PEW PHI PIE PIG PIN PIP PIS PIT PIU PIX PLY POD POH POI POL POM POP POT POW POX PRO PRY PUB PUD PUG PUL PUN PUP PUR PUS PUT PYA PYE PYX
RAD RAG RAH RAJ RAM RAN RAP RAS RAT RAW RAX RAY REB REC RED REE REF REG REI REM REP RES RET REV REX RHO RIB RID RIF RIG RIM RIN RIP ROB ROC ROD ROE ROM ROT ROW RUB RUE RUG RUM RUN RUT RYA RYE
SAB SAC SAD SAE SAG SAL SAP SAT SAU SAW SAX SAY SEA SEC SEE SEG SEI SEL SEN SER SET SEW SHA SHE SHH SHY SIB SIC SIM SIN SIP SIR SIS SIT SIX SKA SKI SKY SLY SOB SOD SOL SOM SON SOP SOS SOT SOU SOW SOX SOY SPA SPY STY SUB SUM SUN SUP SUQ
TAB TAD TAE TAG TAJ TAM TAN TAO TAP TAR TAS TAT TAU TAV TAW TAX TEA TED TEE TEG TEN TET TEW THE THO THY TIC TIE TIN TIP TIS TIT TOD TOE TOG TOM TON TOO TOP TOR TOT TOW TOY TSK TUB TUG TUI TUN TUP TUT TUX TWA TWO TYE
UDO UGH UKE ULU UMP UNI UNS UPO UPS URB URD URN URP URS USE UTA UTE UTS
VAN VAR VAS VAT VAU VAV VAW VEE VEG VET VEX VIA VID VIE VIG VIM VIS VOW VOX
WAB WAD WAE WAG WAN WAP WAR WAS WAT WAW WAX WAY WEB WED WEE WEN WET WHA WHO WHY WIG WIN WIS WIT WIZ WOE WOG WOK WON WOO WOP WOS WOT WOW
XIS
YAH YAK YAM YAP YAW YAY YEA YEH YEN YEP YES YET YEW YID YIN YIP YOB YOD YOK YOM YON YOU YOW YUK YUM YUP
ZAG ZAP ZAX ZED ZEE ZEK ZEN ZEP ZIG ZIN ZIP ZIT ZOA ZOO
ABLE ACHE ACID ACME ACRE AGED AIDE ALLY ALSO ARCH AREA ARMY AUNT AUTO AVID AXLE
BABE BACK BAIT BAKE BALD BALL BAND BANG BANK BARE BARK BARN BASE BASS BATH BEAD BEAK BEAM BEAN BEAR BEAT BEEF BEEN BEER BELL BELT BEND BENT BEST BIKE BILL BIND BIRD BITE BLOW BLUE BLUR BOAR BOAT BODY BOIL BOLD BOLT BOMB BOND BONE BOOK BOOM BOOT BORE BORN BOSS BOTH BOUT BOWL BULK BULL BUMP BURN BURY BUSH BUSY BUZZ
CAFE CAGE CAKE CALM CAME CAMP CAPE CARD CARE CART CASE CASH CAST CAVE CELL CHAT CHEF CHIN CHIP CITY CLAD CLAM CLAN CLAP CLAW CLAY CLIP CLOD CLUB CLUE COAL COAT CODE COIN COLD COLE COLT COME CONE COOK COOL COPE COPY CORD CORE CORK CORN COST COSY COUP COVE COZY CRAB CREW CROP CROW CUBE CULT CURE CURL CUTE
DAFT DALE DAME DAMP DARE DARK DARN DART DASH DATA DATE DAWN DAYS DEAD DEAF DEAL DEAN DEAR DEBT DECK DEED DEEM DEEP DEER DEMO DENT DENY DESK DIAL DICE DIET DIME DINE DIRE DIRT DISH DISK DOCK DOER DOME DONE DOOM DOOR DOSE DOVE DOWN DOZE DRAB DRAG DRAW DREW DRIP DROP DRUG DRUM DUAL DUB DUCK DUEL DULL DUMB DUMP DUNE DUNK DUPE DUSK DUST DUTY DYED
EACH EARN EASE EAST EASY EDGE EDIT ELSE EMIT EPIC EVEN EVER EVIL EXAM EXEC EXIT EXPO EYED EYES
FACE FACT FADE FAIL FAIR FAKE FALL FAME FANG FARE FARM FAST FATE FAWN FEAR FEAT FEED FEEL FEET FELL FELT FEND FERN FEST FEUD FILL FILM FIND FINE FIRE FIRM FISH FIST FLAG FLAK FLAP FLAT FLAW FLEA FLED FLEW FLEX FLIP FLIT FLOG FLOP FLOW FLUE FLUX FOAM FOES FOIL FOLD FOLK FOND FONT FOOD FOOL FOOT FORD FORE FORK FORM FORT FOUL FOUR FOWL FREE FROG FROM FUEL FULL FUME FUND FURY FUSE FUSS FUZZ
GAIT GALE GAME GANG GAPE GARB GASH GATE GAVE GAZE GEAR GENE GIFT GILD GIRL GIST GIVE GLAD GLEE GLEN GLIB GLOW GLUE GLUM GLUT GNAT GNAW GOAT GOES GOLD GOLF GONE GOOD GORY GOWN GRAB GRAM GRAY GREW GRID GRIM GRIN GRIP GRIT GROG GROW GRUB GULF GULL GULP GUST GUTS
HACK HAIL HAIR HALE HALF HALL HALT HALO HAND HANG HARE HARK HARM HARP HASH HASTE HATE HAUL HAVE HAWK HAZE HAZY HEAD HEAL HEAP HEAR HEAT HECK HEED HEEL HELD HELM HELP HERD HERE HERO HIGH HIKE HILL HILT HIND HINT HIRE HOLD HOLE HOME HONE HOOD HOOK HOOP HOPE HORN HOSE HOST HOUR HOWL HUGE HULL HUMP HUNG HUNT HURL HURT HUSH
ICON IDEA IDLE INCH INFO INTO IRON ISLE ITEM
JACK JADE JAIL JAMB JAWS JAZZ JEER JERK JEST JINX JIVE JOBS JOCK JOGS JOIN JOKE JOLT JOTS JOWL JOYS JUDGE JUDO JUGS JUMP JUNK JURY JUST JUTE
KALE KEEN KEEP KELP KENT KEPT KEYS KICK KILL KILT KIND KING KISS KITE KNEE KNEW KNIT KNOB KNOT KNOW
LACE LACK LAID LAKE LAMB LAME LAMP LAND LANE LARD LARK LASH LASS LAST LATE LAWN LAWS LAZY LEAD LEAF LEAK LEAN LEAP LEFT LEND LENS LENT LESS LEVY LIAR LICE LICK LIED LIEU LIFE LIFT LIKE LIMB LIME LIMP LINE LINK LINT LION LIST LIVE LOAD LOAF LOAN LOCK LODE LOFT LONE LONG LOOK LOOM LOOP LORD LORE LOSE LOSS LOST LOUD LOVE LUCK LULL LUMP LUNG LURE LURK LUSH LUST
MACE MADE MAGE MAID MAIL MAIN MAKE MALE MALL MALT MANE MANY MARE MARK MARS MASH MASK MASS MAST MATE MATH MAZE MEAD MEAL MEAN MEAT MEET MELD MELT MEMO MEND MENU MERE MESH MESS MICE MILD MILE MILK MILL MIME MIND MINE MINT MIRE MISS MIST MITT MOAN MOAT MOCK MODE MOLD MOLE MOLT MONK MOOD MOON MOOR MORE MORN MOSS MOST MOTH MOVE MUCH MUCK MULE MULL MUSE MUSH MUSK MUST MUTE MYTH
NAIL NAME NAPE NAVY NEAR NEAT NECK NEED NEST NEWS NEXT NICE NICK NINE NODE NONE NOON NORM NOSE NOTE NOUN NUDE NUMB NUNS NUTS
OAFS OAKS OARS OATH OBEY ODDS ODOR OFFS OGLE OINK OILY OKAY OMEN OMIT ONCE ONLY ONTO OOZE OPAL OPEN OPTS ORAL ORCA OVEN OVER OWED OWED OWLS OWNS OXEN
PACE PACK PAGE PAID PAIL PAIN PAIR PALE PALM PANE PANG PARE PARK PART PASS PAST PATH PAVE PAWN PAYS PEAK PEAL PEAR PEAT PECK PEEL PEER PELT PEND PENT PERK PEST PICK PIER PIKE PILE PILL PINE PINK PINS PIPE PISS PLAN PLAY PLEA PLOD PLOT PLOW PLOY PLUG PLUM PLOP PLUS POEM POET POKE POLE POLL POMP POND POOL POOR POPE POPS PORE PORK PORT POSE POSH POST POUR PREY PRIG PRIM PROD PROP PROW PRRY PRYS PUCK PUFF PULL PULP PUMP PUNK PURE PUSH
QUAD QUAY QUIT QUIZ
RACE RACK RAFT RAGE RAID RAIL RAIN RAKE RAMP RANG RANK RANT RARE RASH RASP RATE RAVE RAYS READ REAL REAM REAP REAR REEF REEL RELY REND RENT REST RICE RICH RIDE RIFT RIND RING RIOT RISE RISK ROAD ROAM ROAR ROBE ROCK RODE ROLE ROLL ROOF ROOM ROOT ROPE ROSE ROTE ROUT ROVE RUDE RUIN RULE RUNG RUSH RUST
SACK SAFE SAGE SAID SAIL SAKE SALE SALT SAME SAND SANE SANG SANK SASH SAVE SAWN SAYS SCAN SCAR SEAL SEAM SEAT SEED SEEK SEEM SEEN SELF SELL SEND SENT SEPT SHED SHIN SHIP SHOE SHOP SHOT SHOW SHUT SICK SIDE SIFT SIGH SIGN SILK SILL SILT SINE SING SINK SIRE SITE SIZE SKID SKIM SKIN SKIP SLAB SLAG SLAM SLAP SLAT SLED SLEW SLID SLIM SLIP SLIT SLOB SLOP SLOT SLOW SLUG SLUM SMOG SNAP SNAG SNIP SNOW SNUB SOAK SOAP SOAR SOCK SODA SOFA SOFT SOIL SOLD SOLE SOME SONG SOON SOOT SORE SORT SOUL SOUR SPAN SPAR SPEC SPED SPIN SPIT SPOT SPUR STAB STAG STAR STAY STEM STEP STEW STIR STOP STUB STUD STUN SUCH SUIT SULK SUMP SUNG SUNK SURE SURF SWAN SWAP SWIM SWUM
TABS TACK TACT TAGS TAIL TAKE TALE TALK TALL TAME TANK TAPE TAPS TART TASK TAXI TEAM TEAR TEEN TELL TEMP TEND TENT TERM TEST TEXT THAN THAT THAW THEM THEN THEY THIN THIS THUD THUS TICK TIDE TIDY TIED TIER TIES TILE TILL TILT TIME TINE TINY TIRE TOAD TOIL TOLD TOLL TOMB TONE TOOK TOOL TOPS TORE TORN TORT TOSS TOUR TOWN TRAP TRAY TREE TREK TRIM TRIO TRIP TROD TROT TRUE TUCK TUBE TUCK TUFT TUNA TUNE TURF TURN TUSK TWIN TWIT TYPE
UGLY UNDO UNIT UNTO UPON URGE USED USER
VAIN VALE VANE VARY VASE VAST VEIL VEIN VENT VERB VERY VEST VETO VIAL VICE VIEW VILE VINE VISA VOID VOLT VOTE
WADE WAGE WAIL WAIT WAKE WALK WALL WAND WANT WARD WARM WARN WARP WART WARY WASH WASP WAVE WAVY WAXY WAYS WEAK WEAN WEAR WEED WEEK WELD WELL WELT WENT WERE WEST WHAT WHEN WHIM WHIP WHOM WICK WIDE WIFE WILD WILL WILT WILY WIMP WIND WINE WING WINK WIPE WIRE WISE WISH WISP WITH WITS WOKE WOLF WOMB WONT WOOD WOOL WORD WORE WORK WORM WORN WOVE WRAP WREN WRIT
YARD YARN YAWN YEAR YELL YOGA YOKE YOUR
ZEAL ZERO ZINC ZONE ZOOM
ABOUT ABOVE ABUSE ADMIT ADOPT ADULT AFTER AGAIN AGENT AGREE AHEAD AIMED ALARM ALIEN ALIGN ALIKE ALIVE ALLOW ALONE ALONG ALTER AMONG ANGEL ANGER ANGLE ANGRY ANIME APART APPLE ARENA ARGUE ARISE ARRAY ASIDE AUDIO AVOID AWAKE AWARE AWFUL
BADGE BASIC BEACH BEGAN BEGIN BEING BELOW BENCH BIBLE BIRTH BLACK BLADE BLAME BLAND BLANK BLAST BLAZE BLEED BLEND BLESS BLIND BLISS BLOCK BLOOM BLOWN BOARD BONUS BOOTH BOUND BRAIN BRAND BRASS BRAVE BREAD BREAK BREED BRICK BRIDE BRIEF BRING BROAD BROKE BROOK BROWN BRUSH BUDDY BUILD BUILT BUNCH BURST BUYER
CABIN CABLE CANDY CARRY CATCH CAUSE CHAIN CHAIR CHANT CHAOS CHARM CHASE CHEAP CHEAT CHECK CHEEK CHEER CHESS CHEST CHIEF CHILD CHINA CHUNK CIVIC CIVIL CLAIM CLASH CLASS CLEAN CLEAR CLERK CLIFF CLIMB CLING CLOCK CLONE CLOSE CLOTH CLOUD COACH COAST COLON COLOR COMES COMIC COULD COUNT COURT COVER CRACK CRAFT CRANE CRASH CRAZY CREAM CREEK CREST CRIME CROPS CROSS CROWD CRUEL CRUSH CUBIC CURVE CYCLE
DAILY DANCE DEALT DEATH DEBUT DELAY DEPTH DEVIL DIARY DIRTY DONOR DOUBT DOUGH DRAFT DRAIN DRAKE DRAMA DRANK DRAWN DREAM DRESS DRIED DRIFT DRILL DRINK DRIVE DRONE DROPS DROVE DRUGS DRUNK DYING
EAGER EARLY EARTH EATER EIGHT ELECT ELITE EMBER EMPTY ENDED ENEMY ENJOY ENTER ENTRY EQUAL ERROR ESSAY EVENT EVERY EXACT EXILE EXIST EXTRA
FACED FAITH FALSE FANCY FATAL FAULT FEAST FENCE FEVER FIBER FIELD FIFTH FIFTY FIGHT FILTH FINAL FLAME FLASH FLESH FLOAT FLOOD FLOOR FLORA FLOUR FLOWN FLUID FLUTE FOCUS FORCE FORGE FORTH FORUM FOUND FRAME FRANK FRAUD FRESH FRONT FROST FROZE FRUIT FULLY FUNNY FUZZY
GIANT GIVEN GLASS GLOBE GLOOM GLORY GOOSE GRACE GRADE GRAIN GRAND GRANT GRAPH GRASP GRASS GRAVE GRAVY GREAT GREEN GRIEF GRILL GRIND GROAN GROOM GROSS GROUP GROWN GUARD GUESS GUEST GUIDE GUILT GUISE GULLY
HABIT HAIRY HAPPY HARSH HAVEN HEART HEAVY HENCE HOBBY HONEY HONOR HORSE HOTEL HOUSE HUMAN HUMOR HURRY
IMAGE IMPLY INDEX INDIE INNER INPUT INTRO IRONY ISSUE IVORY
JEWEL JOINT JOKER JUDGE JUICE JUMBO JUNKY JUROR
KARMA KEBAB KNOCK KNACK KNOWN
LABEL LABOR LANCE LARGE LASER LATER LAYER LEARN LEAST LEAVE LEVEL LEVER LIGHT LIKED LIMIT LINEN LIVER LOBBY LOCAL LODGE LOGIC LOOSE LOVER LOWER LOYAL LUNAR LUNCH LYING LYRIC
MAGIC MAJOR MAKER MANOR MARCH MATCH MAYBE MAYOR MEDIA MERCY MERGE MERIT METAL METER MIGHT MINOR MIXED MODEL MONEY MONTH MORAL MOUNT MOUSE MOUTH MOVED MOVIE MUDDY MUSIC MYTHS
NAIVE NAMED NERVE NEVER NIGHT NOBLE NOISE NORTH NOTED NOVEL NURSE
OCEAN OFFER OFTEN ONSET OPERA ORDER OTHER OUTER OUGHT OWNER OXIDE
PANEL PANIC PAPER PARTY PASTE PATCH PAUSE PEACE PEACH PEARL PENNY PHONE PHOTO PIANO PIECE PILOT PITCH PIXEL PIZZA PLACE PLAIN PLANE PLANT PLATE PLAZA PLEAD PLUCK PLUMB POINT POKER POLAR POUND POWER PRESS PRICE PRIDE PRIME PRINT PRIOR PRIZE PROBE PRONE PROOF PROUD PROVE PROXY PRUNE PSALM PULSE PUNCH PUPIL PURSE
QUEEN QUEST QUEUE QUICK QUIET QUILT QUITE QUOTA QUOTE
RADAR RADIO RAISE RALLY RANCH RANGE RAPID RATIO REACH REALM REBEL REIGN RELAX RELAY RENAL RENEW REPLY RIDER RIDGE RIFLE RIGHT RIGID RISKY RIVAL RIVER ROBOT ROCKY ROMAN ROUGE ROUGH ROUND ROUTE ROYAL RULER RURAL RUSTY
SAINT SALAD SAUCE SCALE SCARE SCENE SCOPE SCORE SCOUT SCRAP SCREW SEIZE SENSE SERVE SETUP SHALL SHAME SHAPE SHARE SHARP SHEER SHELF SHELL SHIFT SHINE SHIRT SHOCK SHORE SHORT SHOUT SHOWN SIGHT SILLY SINCE SIXTH SIXTY SIZED SKILL SKULL SLATE SLEEP SLEPT SLICE SLIDE SLOPE SMALL SMART SMELL SMILE SMOKE SNAKE SOLAR SOLID SOLVE SORRY SOUTH SPACE SPARE SPARK SPEAK SPEED SPENT SPICE SPIKE SPINE SPLIT SPOKE SPOON SPORT SPRAY SQUAD STACK STAFF STAGE STAIN STAKE STALE STALL STAMP STAND STARE START STATE STAYS STEAK STEAL STEAM STEEL STEEP STEER STERN STICK STIFF STILL STOCK STONE STOOD STORE STORM STORY STOVE STRAW STRIP STUCK STUDY STUFF STYLE SUGAR SUITE SUNNY SUPER SURGE SWAMP SWARM SWEAR SWEAT SWEEP SWEET SWEPT SWIFT SWING SWIPE SWORD SWORE SWORN SYRUP
TABLE TAKEN TASTE TEACH TEETH TEMPO TENTH THANK THEME THERE THICK THIEF THING THINK THIRD THORN THOSE THREE THREW THROW THUMB TIGER TIGHT TIMER TIRED TITLE TOAST TODAY TOKEN TOPIC TOTAL TOUCH TOUGH TOWER TOXIC TRACE TRACK TRADE TRAIL TRAIN TRAIT TRASH TREAT TREND TRIAL TRIBE TRICK TRIED TROOP TROUT TRULY TRUMP TRUNK TRUST TRUTH TUMOR TUNED TWICE TWIST TYPED ULTRA
UNDER UNION UNITE UNTIL UPPER URBAN USAGE USHER USUAL UTTER
VAGUE VALID VALUE VAULT VENUE VERSE VIDEO VIGOR VINYL VIRUS VISIT VITAL VIVID VOCAL VODKA VOICE VOTER VOWEL
WAIST WASTE WATCH WATER WAVED WEARY WEAVE WEDGE WEIRD WHEAT WHEEL WHERE WHICH WHILE WHITE WHOLE WHOSE WIDER WITCH WOMAN WORLD WORRY WORSE WORST WORTH WOULD WOUND WRATH WROTE
YACHT YIELD YOUNG YOUTH
ZEBRA ZONAL`;

const _wordSet = new Set<string>();
function getWordSet(): Set<string> {
  if (_wordSet.size === 0) {
    WORD_DATA.split(/\s+/).forEach(w => {
      if (w.length >= 2) _wordSet.add(w.toUpperCase());
    });
  }
  return _wordSet;
}

export function isValidWord(word: string): boolean {
  return getWordSet().has(word.toUpperCase());
}

// ── Word finding on board ────────────────────────────────────────────────────

interface PlacedTile { r: number; c: number; letter: string; }

/**
 * Given the board state + tiles placed this turn, find all words formed
 * and calculate total score. Returns null if placement is invalid.
 */
export function validateAndScore(
  board: string,
  placed: PlacedTile[],
): { words: { word: string; score: number }[]; total: number } | null {
  if (placed.length === 0) return null;

  // All placed tiles must be in same row or same column
  const rows = new Set(placed.map(p => p.r));
  const cols = new Set(placed.map(p => p.c));
  const horizontal = rows.size === 1;
  const vertical = cols.size === 1;
  if (!horizontal && !vertical) return null;
  if (placed.length > 1 && !horizontal && !vertical) return null;

  // Build temporary board with placed tiles
  let tempBoard = board;
  for (const p of placed) {
    tempBoard = setCell(tempBoard, p.r, p.c, p.letter);
  }

  // Check connectivity — placed tiles must connect to existing tiles (or center on first move)
  const boardIsEmpty = board === EMPTY_BOARD;
  if (boardIsEmpty) {
    // First move must cross center
    if (!placed.some(p => p.r === 7 && p.c === 7)) return null;
  } else {
    // At least one placed tile must be adjacent to an existing tile
    const touchesExisting = placed.some(p => {
      const adj = [[p.r-1,p.c],[p.r+1,p.c],[p.r,p.c-1],[p.r,p.c+1]];
      return adj.some(([r,c]) => r >= 0 && r < 15 && c >= 0 && c < 15 && isOccupied(board, r, c));
    });
    if (!touchesExisting) return null;
  }

  // Check no gaps in placed tiles line
  if (placed.length > 1) {
    if (horizontal) {
      const r = placed[0].r;
      const minC = Math.min(...placed.map(p => p.c));
      const maxC = Math.max(...placed.map(p => p.c));
      for (let c = minC; c <= maxC; c++) {
        if (!isOccupied(tempBoard, r, c)) return null;
      }
    } else {
      const c = placed[0].c;
      const minR = Math.min(...placed.map(p => p.r));
      const maxR = Math.max(...placed.map(p => p.r));
      for (let r = minR; r <= maxR; r++) {
        if (!isOccupied(tempBoard, r, c)) return null;
      }
    }
  }

  // Find all words formed
  const placedSet = new Set(placed.map(p => `${p.r},${p.c}`));
  const words: { word: string; score: number }[] = [];

  const readWord = (startR: number, startC: number, dr: number, dc: number): { word: string; positions: [number, number][] } | null => {
    // Expand backwards to find word start
    let r = startR, c = startC;
    while (r - dr >= 0 && r - dr < 15 && c - dc >= 0 && c - dc < 15 && isOccupied(tempBoard, r - dr, c - dc)) {
      r -= dr; c -= dc;
    }
    // Read forward
    const positions: [number, number][] = [];
    let word = '';
    while (r >= 0 && r < 15 && c >= 0 && c < 15 && isOccupied(tempBoard, r, c)) {
      word += getCell(tempBoard, r, c).toUpperCase();
      positions.push([r, c]);
      r += dr; c += dc;
    }
    if (word.length < 2) return null;
    return { word, positions };
  };

  const scoreWord = (word: string, positions: [number, number][]): number => {
    let wordMult = 1;
    let sum = 0;
    for (let i = 0; i < positions.length; i++) {
      const [r, c] = positions[i];
      const letter = word[i];
      let letterScore = TILE_VALUES[letter] || 0;
      const mult = getMultiplier(r, c);
      const isNew = placedSet.has(`${r},${c}`);
      if (isNew) {
        if (mult === 1) letterScore *= 2; // DL
        if (mult === 2) letterScore *= 3; // TL
        if (mult === 3 || mult === 5) wordMult *= 2; // DW / center
        if (mult === 4) wordMult *= 3; // TW
      }
      sum += letterScore;
    }
    return sum * wordMult;
  };

  // Main word (along placement direction)
  const mainDir = horizontal ? [0, 1] : [1, 0];
  const mainWord = readWord(placed[0].r, placed[0].c, mainDir[0], mainDir[1]);
  if (mainWord) {
    if (!isValidWord(mainWord.word)) return null;
    words.push({ word: mainWord.word, score: scoreWord(mainWord.word, mainWord.positions) });
  }

  // Cross words (perpendicular to placement direction)
  const crossDir = horizontal ? [1, 0] : [0, 1];
  for (const p of placed) {
    const crossWord = readWord(p.r, p.c, crossDir[0], crossDir[1]);
    if (crossWord) {
      if (!isValidWord(crossWord.word)) return null;
      words.push({ word: crossWord.word, score: scoreWord(crossWord.word, crossWord.positions) });
    }
  }

  if (words.length === 0) return null;

  let total = words.reduce((s, w) => s + w.score, 0);
  // Bonus for using all 7 tiles
  if (placed.length === 7) total += 50;

  return { words, total };
}

// ── AI opponent ──────────────────────────────────────────────────────────────

export function scrabbleAI(
  board: string,
  rack: string,
): { placed: PlacedTile[]; score: number; word: string } | null {
  const words = getWordSet();
  let bestMove: { placed: PlacedTile[]; score: number; word: string } | null = null;

  // Try placing words at every position in both directions
  const rackArr = rack.split('');
  const directions: [number, number][] = [[0, 1], [1, 0]];

  for (const [dr, dc] of directions) {
    for (let startR = 0; startR < 15; startR++) {
      for (let startC = 0; startC < 15; startC++) {
        // Try words of length 2 to min(7, remaining space)
        const maxLen = Math.min(rackArr.length, dr === 0 ? 15 - startC : 15 - startR);
        if (maxLen < 2) continue;

        // Check if this position connects to existing tiles or is the center
        const boardEmpty = board === EMPTY_BOARD;
        if (boardEmpty && !(startR === 7 && startC === 7) &&
            !(dr === 0 && startR === 7 && startC <= 7 && startC + maxLen > 7) &&
            !(dc === 0 && startC === 7 && startR <= 7 && startR + maxLen > 7)) continue;

        // Try forming words from rack letters
        tryWordsAt(board, rackArr, startR, startC, dr, dc, maxLen, words, (placed, word, score) => {
          if (!bestMove || score > bestMove.score) {
            bestMove = { placed: [...placed], score, word };
          }
        });
      }
    }
  }

  return bestMove;
}

function tryWordsAt(
  board: string,
  rack: string[],
  startR: number, startC: number,
  dr: number, dc: number,
  maxLen: number,
  words: Set<string>,
  onFound: (placed: PlacedTile[], word: string, score: number) => void,
) {
  const available = [...rack];
  const placed: PlacedTile[] = [];
  let r = startR, c = startC;

  // Collect letters we'd place, respecting existing tiles
  const letters: string[] = [];
  const positions: [number, number][] = [];
  let usedFromRack = 0;

  for (let i = 0; i < maxLen && r < 15 && c < 15; i++) {
    if (isOccupied(board, r, c)) {
      letters.push(getCell(board, r, c).toUpperCase());
      positions.push([r, c]);
    } else {
      if (usedFromRack >= available.length) break;
      // We'll try different letters from rack at this position
      letters.push('?'); // placeholder
      positions.push([r, c]);
      usedFromRack++;
    }
    r += dr; c += dc;
  }

  if (usedFromRack === 0 || letters.length < 2) return;

  // For each valid word of this length, check if we can form it
  for (const word of words) {
    if (word.length !== letters.length) continue;
    if (word.length < 2) continue;

    // Check if this word fits with existing tiles and available rack
    const tempAvail = [...rack];
    const tempPlaced: PlacedTile[] = [];
    let valid = true;

    for (let i = 0; i < word.length; i++) {
      const [pr, pc] = positions[i];
      if (isOccupied(board, pr, pc)) {
        if (getCell(board, pr, pc).toUpperCase() !== word[i]) { valid = false; break; }
      } else {
        const idx = tempAvail.indexOf(word[i]);
        if (idx === -1) {
          // Try blank
          const blankIdx = tempAvail.indexOf('_');
          if (blankIdx === -1) { valid = false; break; }
          tempAvail.splice(blankIdx, 1);
        } else {
          tempAvail.splice(idx, 1);
        }
        tempPlaced.push({ r: pr, c: pc, letter: word[i] });
      }
    }

    if (!valid || tempPlaced.length === 0) continue;

    // Validate the full placement
    const result = validateAndScore(board, tempPlaced);
    if (result) {
      onFound(tempPlaced, word, result.total);
    }
  }
}

// ── BlackSwan trash talk for Scrabble ────────────────────────────────────────

const SCRABBLE_LINES = {
  play: [
    'Not bad... for a warm-up.',
    'The board speaks to those who listen.',
    'Triple word, triple the pain.',
    'Every letter has its place.',
    'I see patterns you cannot.',
  ],
  bigWord: [
    'Now THAT is how you play.',
    'The dictionary is my weapon.',
    'Feast your eyes on that score.',
    'Vocabulary is power.',
  ],
  pass: [
    'No moves? How unfortunate.',
    'Even silence speaks volumes.',
    'The bag grows thin...',
  ],
  win: [
    'The tiles have spoken. I win.',
    'A masterclass in wordcraft.',
    'Better luck next time, wordsmith.',
  ],
  lose: [
    'Impressive. You have earned my respect.',
    'The student surpasses the teacher.',
    'Well played. This time.',
  ],
};

export function getScrabbleLine(context: keyof typeof SCRABBLE_LINES): string {
  const lines = SCRABBLE_LINES[context];
  return lines[Math.floor(Math.random() * lines.length)];
}
