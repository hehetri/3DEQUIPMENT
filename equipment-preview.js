import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/*
    equipment-preview.js

    VersÃ£o corrigida para BSC estÃ¡tico sem .bon:

    - BSC usa eixo igual ao parser original: x, y, z
    - NÃƒO centraliza head/body/arm separadamente
    - NÃƒO usa offsets manuais para head/body/arm
    - OBJ/equipamentos usam -x, y, z
    - equipamento Ã© centralizado no prÃ³prio pivÃ´ antes de anexar
    - NÃƒO recentraliza a cena depois de equipar
    - BSC usa textura .ba0, .ba1, .ba2...
    - OBJ usa textura .oa0.png, .ob0.png, .oc0.png...

    Estrutura esperada:

    assets/models/
        hs_000_head.bsc.json
        hs_000_head.ba0

        hs_000_body.bsc.json
        hs_000_body.ba0

        hs_000_arm.bsc.json
        hs_000_arm.ba0
        hs_000_arm.ba2

        wing_540.obj.json
        wing_540.oa0.png
        wing_540.ob0.png

        aura_220.obj.json
        aura_220.oa0.png
*/

const ITEM_3D_TYPES = {
    "301": { type: "obj", prefix: "mini" },
    "302": { type: "obj", prefix: "fg", attach_to: "<match>" },
    "303": { type: "obj", prefix: "aura" },
    "304": { type: "obj", prefix: "wing", attach_to: "bonewing" },
    "305": { type: "obj", prefix: "shield", attach_to: "bone_shield" },
    "306": { type: "obj", prefix: "shoulder", attach_to: "bone_shoulder" },
    "307": { type: "obj", prefix: "flag1st", attach_to: "bone_flag1" },
    "308": { type: "obj", prefix: "flag2nd", attach_to: "bone_flag2" },
    "801": { type: "obj", prefix: "mini" }
};

const DEFAULT_CHARACTER = {
    bone: "hs_bone",
    head: "hs_000_head",
    body: "hs_000_body",
    arm: "hs_000_arm"
};

/*
    Como nÃ£o existe .bon, estes bones sÃ£o apenas pontos virtuais para anexar itens.
    Ajuste estes valores conforme a posiÃ§Ã£o visual no seu viewer.
*/
const DEFAULT_ATTACH_BONES = [
    {
        name: "bonewing",
        position: [0, 42, -32],
        rotation: [0, 0, 0],
        scale: [0.75, 0.75, 0.75]
    },
    {
        name: "bone_shield",
        position: [-34, 34, 10],
        rotation: [0, 0, 0],
        scale: [1, 1, 1]
    },
    {
        name: "bone_shoulder",
        position: [0, 50, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1]
    },
    {
        name: "bone_flag1",
        position: [-25, 50, -20],
        rotation: [0, 0, 0],
        scale: [1, 1, 1]
    },
    {
        name: "bone_flag2",
        position: [25, 50, -20],
        rotation: [0, 0, 0],
        scale: [1, 1, 1]
    },
    {
        name: "aura_root",
        position: [0, 25, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1]
    }
];

function normalizeBoneName(name) {
    return String(name || "")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeLookupName(name) {
    return normalizeBoneName(name).toLowerCase();
}

function bytesToMatrix4(byteList) {
    if (!byteList) {
        return new THREE.Matrix4();
    }

    const raw = new Uint8Array(byteList);
    const floats = new Float32Array(raw.buffer);

    const matrix = new THREE.Matrix4();
    matrix.fromArray(Array.from(floats));

    return matrix;
}

function getValidFrameBytes(frameMats, frameIndex) {
    if (!frameMats || !frameMats.length) {
        return null;
    }

    const index = Math.min(frameIndex, frameMats.length - 1);

    if (frameMats[index]) {
        return frameMats[index];
    }

    for (let i = index - 1; i >= 0; i--) {
        if (frameMats[i]) {
            return frameMats[i];
        }
    }

    for (let i = index + 1; i < frameMats.length; i++) {
        if (frameMats[i]) {
            return frameMats[i];
        }
    }

    return null;
}

function getMaxFramesFromBones(bones) {
    let max = 1;

    for (const bone of bones || []) {
        if (bone.frameMats && bone.frameMats.length > max) {
            max = bone.frameMats.length;
        }
    }

    return max;
}

function isObjRawJson(data) {
    return data && Array.isArray(data.bones) && Array.isArray(data.meshes);
}

function isRawBscJson(data) {
    return data && data.header && Array.isArray(data.meshes);
}

function isProcessedModel(data) {
    return data && Array.isArray(data.meshData);
}

function isAuraLike(modelInfo, data) {
    if (modelInfo.prefix === "aura") {
        return true;
    }

    const meshes = data?.meshes || [];

    return (
        meshes.length === 1 &&
        meshes[0].numVertices === 4 &&
        meshes[0].numIndices === 6
    );
}

function makeTexturePath(assetPath, textureName) {
    if (!textureName) {
        return null;
    }

    return `${assetPath}/${textureName}`;
}

function textureNameFromBaseAndTexId(base, texId, type = "obj") {
    if (type === "bsc") {
        return `${base}.ba${texId}`;
    }

    let code = 97 + texId;

    if (code > 122) {
        code -= 75;
    }

    return `${base}.o${String.fromCharCode(code)}0.png`;
}

function getVertexPosition(v) {
    const p = v?.pos || v?.position || v?.p || {};

    return {
        x: Number(p.x ?? p[0] ?? 0),
        y: Number(p.y ?? p[1] ?? 0),
        z: Number(p.z ?? p[2] ?? 0)
    };
}

function getVertexNormal(v) {
    const n = v?.normal || v?.n || {};

    return {
        x: Number(n.x ?? n[0] ?? 0),
        y: Number(n.y ?? n[1] ?? 1),
        z: Number(n.z ?? n[2] ?? 0)
    };
}

function getVertexUv(v) {
    const uv = v?.uv || v?.t || {};

    return {
        u: Number(uv.u ?? uv.x ?? uv[0] ?? 0),
        v: Number(uv.v ?? uv.y ?? uv[1] ?? 0)
    };
}

export function getModelFromItemId(itemId, options = {}) {
    const assetPath = options.assetPath || "assets/models";

    const id = String(itemId).padStart(7, "0");
    const numericPrefix = id.substring(0, 3);
    const modelNumber = id.substring(3, 6);

    const config = ITEM_3D_TYPES[numericPrefix];

    if (!config) {
        return null;
    }

    const base = `${config.prefix}_${modelNumber}`;

    return {
        itemId,
        kind: "equipment",
        type: config.type,
        numericPrefix,
        prefix: config.prefix,
        modelNumber,
        base,
        json: `${assetPath}/${base}.obj.json`,
        textures: {
            0: `${assetPath}/${base}.oa0.png`,
            1: `${assetPath}/${base}.ob0.png`,
            2: `${assetPath}/${base}.oc0.png`,
            3: `${assetPath}/${base}.od0.png`
        },
        attach_to: config.attach_to || null,
        slot: config.prefix
    };
}

export function getEquipmentFromBase(base, options = {}) {
    const assetPath = options.assetPath || "assets/models";
    const parts = String(base).split("_");
    const prefix = parts[0] || "";
    const modelNumber = parts[1] || "000";

    let attach_to = null;

    for (const entry of Object.values(ITEM_3D_TYPES)) {
        if (entry.prefix === prefix) {
            attach_to = entry.attach_to || null;
            break;
        }
    }

    return {
        itemId: null,
        kind: "equipment",
        type: "obj",
        prefix,
        modelNumber,
        base,
        json: `${assetPath}/${base}.obj.json`,
        textures: {
            0: `${assetPath}/${base}.oa0.png`,
            1: `${assetPath}/${base}.ob0.png`,
            2: `${assetPath}/${base}.oc0.png`,
            3: `${assetPath}/${base}.od0.png`
        },
        attach_to,
        slot: prefix
    };
}

export function getBscPartFromBase(base, options = {}) {
    const assetPath = options.assetPath || "assets/models";

    return {
        itemId: null,
        kind: "character",
        type: "bsc",
        prefix: base.split("_")[0] || "hs",
        base,
        json: `${assetPath}/${base}.bsc.json`,
        textureBase: base,
        slot: base.includes("_head")
            ? "head"
            : base.includes("_body")
                ? "body"
                : base.includes("_arm")
                    ? "arm"
                    : "part"
    };
}

export function getBonFromBase(base, options = {}) {
    const assetPath = options.assetPath || "assets/models";

    return {
        kind: "skeleton",
        type: "bon",
        base,
        json: `${assetPath}/${base}.bon.json`
    };
}

function matrixFromRows(rows) {
    const r1 = rows?.row1 || {};
    const r2 = rows?.row2 || {};
    const r3 = rows?.row3 || {};
    const r4 = rows?.row4 || {};

    /*
        IMPORTANTE:
        O .bon vem em matriz row-major / row-vector:
            row1 = eixo X
            row2 = eixo Y
            row3 = eixo Z
            row4 = traduÃ§Ã£o

        No Three.js a traduÃ§Ã£o precisa ficar na ÃšLTIMA COLUNA.
        EntÃ£o precisamos transpor a matriz.

        Se usar row4 como Ãºltima linha, o decompose() lÃª posiÃ§Ã£o como 0,0,0
        e todos os bones ficam embolados no centro.
    */
    const matrix = new THREE.Matrix4();

    matrix.set(
        Number(r1.x ?? 1), Number(r2.x ?? 0), Number(r3.x ?? 0), Number(r4.x ?? 0),
        Number(r1.y ?? 0), Number(r2.y ?? 1), Number(r3.y ?? 0), Number(r4.y ?? 0),
        Number(r1.z ?? 0), Number(r2.z ?? 0), Number(r3.z ?? 1), Number(r4.z ?? 0),
        Number(r1.w ?? 0), Number(r2.w ?? 0), Number(r3.w ?? 0), Number(r4.w ?? 1)
    );

    return matrix;
}

function getFirstValidMatrix(boneData) {
    if (boneData?.bindMatrix) {
        return boneData.bindMatrix;
    }

    if (Array.isArray(boneData?.frameMatrices)) {
        for (const matrix of boneData.frameMatrices) {
            if (matrix) {
                return matrix;
            }
        }
    }

    return null;
}


export class EquipmentPreview {
    constructor(options = {}) {
        this.container =
            typeof options.container === "string"
                ? document.querySelector(options.container)
                : options.container;

        if (!this.container) {
            throw new Error("EquipmentPreview: container nÃ£o encontrado.");
        }

        this.assetPath = options.assetPath || "assets/models";
        this.background = options.background ?? null;
        this.showGrid = options.showGrid ?? false;
        this.autoPlay = options.autoPlay ?? true;
        this.fps = options.fps || 30;
        this.animationSpeed = options.animationSpeed ?? 0.45;
        this.attachBones = options.attachBones || DEFAULT_ATTACH_BONES;

        this.cameraPosition = options.cameraPosition || { x: 0, y: 48, z: 185 };
        this.controlsTarget = options.controlsTarget || { x: 0, y: 36, z: 0 };

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;

        this.root = null;
        this.characterRoot = null;
        this.equipmentRoot = null;
        this.characterBoneRoot = null;

        this.clock = new THREE.Clock();
        this.animationId = null;
        this.resizeObserver = null;

        this.characterSkeleton = null;
        this.characterBoneMap = new Map();
        this.characterBoneIndexMap = new Map();
        this.characterParts = new Map();

        this.equipped = new Map();
        this.mixers = [];

        this.textureCache = new Map();
        this.materialCache = new Map();

        this.playing = this.autoPlay;

        this.bonAnimation = null;
        this.bonAnimTime = 0;
        this.bonAnimFrameIndex = 0;

        this.init();
    }

    init() {
        this.scene = new THREE.Scene();

        if (this.background !== null) {
            this.scene.background = new THREE.Color(this.background);
        }

        const width = this.container.clientWidth || 500;
        const height = this.container.clientHeight || 620;

        this.camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 5000);

        this.camera.position.set(
            this.cameraPosition.x,
            this.cameraPosition.y,
            this.cameraPosition.z
        );

        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true
        });

        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio || 1);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;

        this.container.innerHTML = "";
        this.container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.enablePan = false;

        this.controls.target.set(
            this.controlsTarget.x,
            this.controlsTarget.y,
            this.controlsTarget.z
        );

        this.scene.add(new THREE.AmbientLight(0xffffff, 1.8));

        const keyLight = new THREE.DirectionalLight(0xffffff, 2.3);
        keyLight.position.set(120, 220, 160);
        this.scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0xffffff, 0.9);
        fillLight.position.set(-150, 90, -170);
        this.scene.add(fillLight);

        if (this.showGrid) {
            this.scene.add(new THREE.GridHelper(300, 30));
        }

        this.root = new THREE.Group();
        this.root.name = "PreviewRoot";
        this.scene.add(this.root);

        this.characterRoot = new THREE.Group();
        this.characterRoot.name = "CharacterRoot";
        this.characterRoot.rotation.x = -Math.PI / 2;
        this.characterRoot.rotation.y = Math.PI;
        this.characterRoot.scale.x = -1;
        this.root.add(this.characterRoot);

        this.equipmentRoot = new THREE.Group();
        this.equipmentRoot.name = "EquipmentRoot";
        this.root.add(this.equipmentRoot);

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.container);

        this.animate();
    }

    async loadDefaultCharacter() {
        return await this.loadCharacter(DEFAULT_CHARACTER);
    }

    async loadCharacter(parts = DEFAULT_CHARACTER) {
        this.clearCharacter();
        this.clearEquipment();

        const bone = parts.bone || DEFAULT_CHARACTER.bone;
        const body = parts.body || DEFAULT_CHARACTER.body;
        const head = parts.head || DEFAULT_CHARACTER.head;
        const arm = parts.arm || DEFAULT_CHARACTER.arm;

        const bonInfo = getBonFromBase(bone, { assetPath: this.assetPath });
        const bodyInfo = body ? getBscPartFromBase(body, { assetPath: this.assetPath }) : null;
        const headInfo = head ? getBscPartFromBase(head, { assetPath: this.assetPath }) : null;
        const armInfo = arm ? getBscPartFromBase(arm, { assetPath: this.assetPath }) : null;

        const bonData = await this.fetchJson(bonInfo.json);
        const bodyData = bodyInfo ? await this.fetchJson(bodyInfo.json) : null;
        const headData = headInfo ? await this.fetchJson(headInfo.json) : null;
        const armData = armInfo ? await this.fetchJson(armInfo.json) : null;

        if (!bodyData) {
            console.warn("Body nÃ£o encontrado:", bodyInfo?.json || body);
            return null;
        }

        if (bonData) {
            this.createCharacterSkeletonFromBon(bonData);
            this.createBonAnimationMixer(bonData);
        } else {
            console.warn("BON skeleton nÃ£o encontrado:", bonInfo.json);
            this.createVirtualAttachBonesOnly();
        }

        const loadedPartBases = new Set();

        await this.addBscPart(bodyData, bodyInfo);
        loadedPartBases.add(bodyInfo.base);

        if (headInfo && headData) {
            if (!loadedPartBases.has(headInfo.base)) {
                await this.addBscPart(headData, headInfo);
                loadedPartBases.add(headInfo.base);
            }
        } else if (headInfo) {
            console.warn("Head nÃ£o encontrado:", headInfo.json);
        }

        if (armInfo && armData) {
            if (!loadedPartBases.has(armInfo.base)) {
                await this.addBscPart(armData, armInfo);
                loadedPartBases.add(armInfo.base);
            }
        } else if (armInfo) {
            console.warn("Arm nÃ£o encontrado:", armInfo.json);
        }

        this.centerObject(this.root);

        return {
            bon: bonData,
            head: headData,
            body: bodyData,
            arm: armData
        };
    }

    async equipItemById(itemId) {
        const modelInfo = getModelFromItemId(itemId, {
            assetPath: this.assetPath
        });

        if (!modelInfo) {
            console.warn("Item sem modelo:", itemId);
            return null;
        }

        return await this.equipItem(modelInfo);
    }

    async equipItemByBase(base, slot = null) {
        const modelInfo = getEquipmentFromBase(base, {
            assetPath: this.assetPath
        });

        if (slot) {
            modelInfo.slot = slot;
        }

        return await this.equipItem(modelInfo);
    }

    async equipItem(modelInfo) {
        if (!this.characterBoneRoot) {
            console.warn("Carregue o personagem primeiro: await preview.loadDefaultCharacter()");
        }

        const slotName = modelInfo.slot || modelInfo.prefix || modelInfo.base;

        this.unequipSlot(slotName);

        const data = await this.fetchJson(modelInfo.json);

        if (!data) {
            console.warn("Equipamento nÃ£o encontrado:", modelInfo.json);
            return null;
        }

        const equipmentObject = await this.buildObjEquipment(data, modelInfo);

        if (!equipmentObject) {
            return null;
        }

        equipmentObject.name = `equipped_${slotName}_${modelInfo.base}`;

        const attachTarget = this.findAttachTarget(modelInfo);
        attachTarget.add(equipmentObject);

        this.equipped.set(slotName, {
            object: equipmentObject,
            modelInfo,
            data
        });

        /*
            NÃƒO centralizar depois de equipar.
            Se fizer isso, a wing muda o centro e joga o robÃ´ para baixo.
        */
        return equipmentObject;
    }

    unequipSlot(slotName) {
        const current = this.equipped.get(slotName);

        if (!current) {
            return;
        }

        if (current.object.parent) {
            current.object.parent.remove(current.object);
        }

        this.disposeObject(current.object);
        this.equipped.delete(slotName);
    }

    clearEquipment() {
        for (const slotName of Array.from(this.equipped.keys())) {
            this.unequipSlot(slotName);
        }

        while (this.equipmentRoot && this.equipmentRoot.children.length > 0) {
            const child = this.equipmentRoot.children[0];
            this.equipmentRoot.remove(child);
            this.disposeObject(child);
        }

        this.equipped.clear();
    }

    clearCharacter() {
        this.mixers = [];

        while (this.characterRoot && this.characterRoot.children.length > 0) {
            const child = this.characterRoot.children[0];
            this.characterRoot.remove(child);
            this.disposeObject(child);
        }

        this.characterSkeleton = null;
        this.characterBoneRoot = null;
        this.characterBoneMap.clear();
        this.characterBoneIndexMap.clear();
        this.characterParts.clear();
    }

    async fetchJson(path) {
        try {
            const response = await fetch(path, { cache: "no-store" });

            if (!response.ok) {
                return null;
            }

            return await response.json();
        } catch (error) {
            console.warn("Erro ao carregar JSON:", path, error);
            return null;
        }
    }

    createVirtualAttachBonesOnly() {
        this.characterBoneRoot = new THREE.Bone();
        this.characterBoneRoot.name = "Root";
        this.characterRoot.add(this.characterBoneRoot);

        this.characterBoneMap.clear();
        this.characterBoneIndexMap.clear();

        for (const info of this.attachBones) {
            const bone = new THREE.Bone();
            bone.name = info.name;

            bone.position.fromArray(info.position || [0, 0, 0]);
            bone.rotation.set(
                info.rotation?.[0] || 0,
                info.rotation?.[1] || 0,
                info.rotation?.[2] || 0
            );
            bone.scale.fromArray(info.scale || [1, 1, 1]);

            this.characterBoneRoot.add(bone);
            this.characterBoneIndexMap.set(normalizeLookupName(bone.name), this.characterBoneMap.size);
            this.characterBoneMap.set(normalizeLookupName(bone.name), bone);
        }

        const bones = Array.from(this.characterBoneMap.values());
        this.characterSkeleton = new THREE.Skeleton(bones);
    }

    createCharacterSkeletonFromBon(data) {
        this.characterBoneRoot = new THREE.Bone();
        this.characterBoneRoot.name = "Root";
        this.characterRoot.add(this.characterBoneRoot);

        this.characterBoneMap.clear();
        this.characterBoneIndexMap.clear();

        const sourceBones =
            data?.skeleton?.bones ||
            data?.bones ||
            [];

        for (const boneData of sourceBones) {
            const matrixRows = getFirstValidMatrix(boneData);

            if (!matrixRows) {
                continue;
            }

            const bone = new THREE.Bone();
            bone.name = normalizeBoneName(boneData.name);

            const matrix = matrixFromRows(matrixRows);
            matrix.decompose(bone.position, bone.quaternion, bone.scale);
            bone.quaternion.normalize();

            this.characterBoneRoot.add(bone);

            const lookup = normalizeLookupName(bone.name);
            this.characterBoneIndexMap.set(lookup, this.characterBoneMap.size);
            this.characterBoneMap.set(lookup, bone);
        }

        /*
            MantÃ©m os pontos extras de attachment se eles nÃ£o existirem no BON.
            Se o BON tiver bonewing/bone_shield, o cÃ³digo usa o bone real.
        */
        for (const info of this.attachBones) {
            const lookup = normalizeLookupName(info.name);

            if (this.characterBoneMap.has(lookup)) {
                continue;
            }

            const bone = new THREE.Bone();
            bone.name = info.name;
            bone.position.fromArray(info.position || [0, 0, 0]);
            bone.rotation.set(
                info.rotation?.[0] || 0,
                info.rotation?.[1] || 0,
                info.rotation?.[2] || 0
            );
            bone.scale.fromArray(info.scale || [1, 1, 1]);

            this.characterBoneRoot.add(bone);
            this.characterBoneIndexMap.set(lookup, this.characterBoneMap.size);
            this.characterBoneMap.set(lookup, bone);
        }

        const bones = Array.from(this.characterBoneMap.values());
        this.characterSkeleton = new THREE.Skeleton(bones);
    }


    createBonAnimationMixer(data) {
        /*
            Nome mantido para compatibilidade, mas agora NÃƒO usa AnimationMixer.
            O .bon tem frameMatrices grandes e muitos frames null/estÃ¡ticos.
            O mixer pode comeÃ§ar numa Ã¡rea parada e parecer que nÃ£o animou.

            Aqui criamos um player manual:
            - descobre todos os frames realmente vÃ¡lidos
            - em cada tick aplica diretamente matrix -> position/quaternion/scale no bone
        */
        const sourceBones =
            data?.skeleton?.bones ||
            data?.bones ||
            [];

        if (!sourceBones.length || !this.characterBoneRoot) {
            return;
        }

        const frameSet = new Set();
        const boneFrames = new Map();

        for (const boneData of sourceBones) {
            const boneName = normalizeBoneName(boneData.name);
            const bone = this.characterBoneMap.get(normalizeLookupName(boneName));

            if (!bone) {
                continue;
            }

            const frames = Array.isArray(boneData.frameMatrices)
                ? boneData.frameMatrices
                : [];

            const valid = [];

            for (let i = 0; i < frames.length; i++) {
                if (frames[i]) {
                    valid.push({
                        frame: i,
                        matrixRows: frames[i]
                    });
                    frameSet.add(i);
                }
            }

            if (!valid.length && boneData.bindMatrix) {
                valid.push({
                    frame: 0,
                    matrixRows: boneData.bindMatrix
                });
                frameSet.add(0);
            }

            boneFrames.set(normalizeLookupName(boneName), {
                bone,
                valid,
                bindMatrix: boneData.bindMatrix || null
            });
        }

        let frames = Array.from(frameSet).sort((a, b) => a - b);

        /*
            Muitos .bon tÃªm centenas de frames iniciais parados e depois animaÃ§Ã£o.
            Removemos a sequÃªncia inicial onde quase nada muda, mas mantendo seguranÃ§a.
        */
        if (frames.length > 10) {
            const first = frames[0];
            let cut = 0;

            for (let i = 1; i < frames.length; i++) {
                if (frames[i] - first > 5) {
                    cut = i;
                    break;
                }
            }

            if (cut > 0 && cut < frames.length - 5) {
                frames = frames.slice(cut);
            }
        }

        this.bonAnimation = {
            fps: this.fps || 30,
            frames,
            boneFrames
        };

        this.bonAnimTime = 0;
        this.bonAnimFrameIndex = 0;

        /*
            Aplica o primeiro frame imediatamente.
        */
        this.updateBonAnimation(0, true);
    }

    findNearestBoneFrame(validFrames, frameNumber) {
        if (!validFrames || !validFrames.length) {
            return null;
        }

        let best = validFrames[0];

        for (const item of validFrames) {
            if (item.frame <= frameNumber) {
                best = item;
            } else {
                break;
            }
        }

        return best;
    }

    updateBonAnimation(delta, force = false) {
        if (!this.bonAnimation || !this.bonAnimation.frames.length) {
            return;
        }

        if (!this.playing && !force) {
            return;
        }

        const anim = this.bonAnimation;

        this.bonAnimTime += delta * this.animationSpeed;

        const frameStep = Math.floor(this.bonAnimTime * anim.fps);

        if (!force && frameStep === this.bonAnimFrameIndex) {
            return;
        }

        this.bonAnimFrameIndex = frameStep;

        const frameNumber = anim.frames[frameStep % anim.frames.length];

        for (const item of anim.boneFrames.values()) {
            const nearest = this.findNearestBoneFrame(item.valid, frameNumber);
            const rows = nearest?.matrixRows || item.bindMatrix;

            if (!rows) {
                continue;
            }

            const matrix = matrixFromRows(rows);

            const p = new THREE.Vector3();
            const q = new THREE.Quaternion();
            const s = new THREE.Vector3();

            matrix.decompose(p, q, s);
            q.normalize();

            item.bone.position.copy(p);
            item.bone.quaternion.copy(q);
            item.bone.scale.copy(s);
            item.bone.updateMatrixWorld(true);
        }

        this.characterBoneRoot.updateMatrixWorld(true);
    }

    async addBscPart(data, modelInfo) {
        const normalized = this.normalizeModelData(data, modelInfo);

        const group = new THREE.Group();
        group.name = `part_${modelInfo.slot}_${modelInfo.base}`;

        /*
            Igual ao viewer original:
            o SkinnedMesh fica anexado no grupo/root do personagem,
            mas Ã© bindado com um Skeleton contendo APENAS o bone da mesh.
        */
        this.characterRoot.add(group);
        this.characterParts.set(modelInfo.slot, group);

        this.characterBoneRoot.updateMatrixWorld(true);

        let matched = 0;
        let missing = 0;

        for (const meshData of normalized.meshData) {
            const geometry = this.createGeometryFromMeshData(meshData);

            const material = await this.getMaterialFromTextureName(
                meshData.textureName,
                modelInfo,
                false
            );

            const boneName = normalizeLookupName(meshData.boneName);
            const targetBone = this.characterBoneMap.get(boneName);

            let mesh;

            if (targetBone) {
                matched++;

                const vertexCount = geometry.getAttribute("position").count;
                const skinIndex = new Uint16Array(vertexCount * 4);
                const skinWeight = new Float32Array(vertexCount * 4);

                /*
                    Skeleton de 1 bone: o Ã­ndice sempre Ã© 0.
                    Isso bate com o cÃ³digo original:
                    skinIndex = Uint16Array(...).fill(0)
                    skinWeight = 1 no primeiro peso
                */
                for (let i = 0; i < vertexCount; i++) {
                    skinIndex[i * 4 + 0] = 0;
                    skinIndex[i * 4 + 1] = 0;
                    skinIndex[i * 4 + 2] = 0;
                    skinIndex[i * 4 + 3] = 0;

                    skinWeight[i * 4 + 0] = 1;
                    skinWeight[i * 4 + 1] = 0;
                    skinWeight[i * 4 + 2] = 0;
                    skinWeight[i * 4 + 3] = 0;
                }

                geometry.setAttribute(
                    "skinIndex",
                    new THREE.Uint16BufferAttribute(skinIndex, 4)
                );

                geometry.setAttribute(
                    "skinWeight",
                    new THREE.Float32BufferAttribute(skinWeight, 4)
                );

                /*
                    inverseBindMatrix:
                    o viewer original usa data.inverseBindMatrices[boneName].
                    Como nosso JSON nÃ£o traz esse mapa pronto, calculamos pela pose atual do bone.
                */
                targetBone.updateMatrixWorld(true);

                const inverse = new THREE.Matrix4()
                    .copy(targetBone.matrixWorld)
                    .invert();

                const singleBoneSkeleton = new THREE.Skeleton(
                    [targetBone],
                    [inverse]
                );

                mesh = new THREE.SkinnedMesh(geometry, material);
                mesh.bind(singleBoneSkeleton, new THREE.Matrix4().identity());
                mesh.frustumCulled = false;
            } else {
                missing++;
                mesh = new THREE.Mesh(geometry, material);
            }

            mesh.name = `${modelInfo.base}_${meshData.boneName || "mesh"}`;
            group.add(mesh);
        }

        console.log(
            `[BSC] ${modelInfo.base}: matched bones=${matched}, missing bones=${missing}`
        );
    }

    async buildObjEquipment(data, modelInfo) {
        const normalized = this.normalizeModelData(data, modelInfo);

        const root = new THREE.Group();
        root.name = modelInfo.base;

        const internal = this.createInternalObjSkeleton(normalized.internalSkeleton, root);

        if (Array.isArray(data.bones) && data.bones.length && internal.rootBone) {
            this.createRawObjMixer(data, internal);
        }

        const auraMode = isAuraLike(modelInfo, data);

        for (const meshData of normalized.meshData) {
            const geometry = auraMode
                ? this.createAuraGeometryFromRawOrProcessed(meshData, data)
                : this.createGeometryFromMeshData(meshData);

            const material = meshData.textureName
                ? await this.getMaterialFromTextureName(meshData.textureName, modelInfo, auraMode)
                : await this.getMaterialFromTexId(modelInfo, meshData.texId ?? 0, auraMode);

            const mesh = new THREE.Mesh(geometry, material);
            mesh.name = `${modelInfo.base}_${meshData.boneName || "mesh"}`;

            const targetBone = internal.boneMap.get(normalizeLookupName(meshData.boneName));

            if (targetBone) {
                targetBone.add(mesh);
            } else {
                root.add(mesh);
            }
        }

        /*
            Centraliza o equipamento no prÃ³prio pivÃ´ antes de anexar.
            Isso evita que a wing fique voando muito acima.
        */
        this.centerEquipmentLocal(root);

        return root;
    }

    createInternalObjSkeleton(internalSkeleton, root) {
        const boneMap = new Map();

        const rootBone = new THREE.Bone();
        rootBone.name = internalSkeleton?.rootName || "ObjRoot";
        root.add(rootBone);

        const bones = internalSkeleton?.bones || [];

        for (const boneInfo of bones) {
            const bone = new THREE.Bone();
            bone.name = normalizeBoneName(boneInfo.name);

            if (Array.isArray(boneInfo.pos)) {
                bone.position.fromArray(boneInfo.pos);
            }

            if (Array.isArray(boneInfo.rot)) {
                bone.quaternion.fromArray(boneInfo.rot).normalize();
            }

            if (Array.isArray(boneInfo.scl)) {
                bone.scale.fromArray(boneInfo.scl);
            }

            if (boneInfo.matrix) {
                const matrix = Array.isArray(boneInfo.matrix)
                    ? bytesToMatrix4(boneInfo.matrix)
                    : boneInfo.matrix;

                matrix.decompose(bone.position, bone.quaternion, bone.scale);
                bone.quaternion.normalize();
            }

            rootBone.add(bone);
            boneMap.set(normalizeLookupName(bone.name), bone);
        }

        return {
            rootBone,
            boneMap
        };
    }

    createRawObjMixer(data, internal) {
        const bones = data.bones || [];

        if (!bones.length || !internal.rootBone) {
            return;
        }

        const tracks = [];
        const maxFrames = getMaxFramesFromBones(bones);
        const duration = Math.max(1 / this.fps, (maxFrames - 1) / this.fps);

        for (const boneData of bones) {
            const boneName = normalizeBoneName(boneData.name);
            const target = internal.boneMap.get(normalizeLookupName(boneName));

            if (!target) {
                continue;
            }

            const times = [];
            const pos = [];
            const rot = [];
            const scl = [];

            let prevQuat = null;

            for (let frame = 0; frame < maxFrames; frame++) {
                const frameBytes =
                    getValidFrameBytes(boneData.frameMats, frame) ||
                    boneData.boneBuff;

                if (!frameBytes) {
                    continue;
                }

                const matrix = bytesToMatrix4(frameBytes);

                const p = new THREE.Vector3();
                const q = new THREE.Quaternion();
                const s = new THREE.Vector3();

                matrix.decompose(p, q, s);
                q.normalize();

                if (prevQuat && prevQuat.dot(q) < 0) {
                    q.x *= -1;
                    q.y *= -1;
                    q.z *= -1;
                    q.w *= -1;
                }

                prevQuat = q.clone();

                times.push(frame / this.fps);
                pos.push(p.x, p.y, p.z);
                rot.push(q.x, q.y, q.z, q.w);
                scl.push(s.x, s.y, s.z);
            }

            if (times.length < 2) {
                continue;
            }

            tracks.push(new THREE.VectorKeyframeTrack(`${boneName}.position`, times, pos));
            tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, rot));
            tracks.push(new THREE.VectorKeyframeTrack(`${boneName}.scale`, times, scl));
        }

        if (!tracks.length) {
            return;
        }

        const clip = new THREE.AnimationClip("obj_animation", duration, tracks);
        const mixer = new THREE.AnimationMixer(internal.rootBone);
        const action = mixer.clipAction(clip);

        action.reset();
        action.play();

        this.mixers.push(mixer);
    }

    normalizeModelData(data, modelInfo) {
        if (isProcessedModel(data)) {
            return data;
        }

        if (modelInfo.type === "bsc" && isRawBscJson(data)) {
            return this.convertRawBscToProcessed(data, modelInfo);
        }

        if (isObjRawJson(data)) {
            return this.convertRawObjToProcessed(data, modelInfo);
        }

        const meshData = data.meshData || data.meshes || [];
        const internalSkeleton = data.internalSkeleton || data.skeleton || {
            rootName: "Root",
            bones: [],
            animations: []
        };

        return {
            type: modelInfo.type || "unknown",
            meshData,
            internalSkeleton,
            overriddenBones: data.overriddenBones || [],
            inverseBindMatrices: data.inverseBindMatrices || []
        };
    }

    convertRawBscToProcessed(data, modelInfo) {
        const meshData = [];
        const numTextures = data?.header?.texCount ?? 4;

        for (let meshIndex = 0; meshIndex < (data.meshes || []).length; meshIndex++) {
            const mesh = data.meshes[meshIndex];

            const positions = [];
            const normals = [];
            const uvs = [];
            const indices = [];

            const vertices = mesh.vertices || [];

            for (const v of vertices) {
                const p = getVertexPosition(v);
                const n = getVertexNormal(v);
                const uv = getVertexUv(v);

                /*
                    ConversÃ£o correta do BSC pelo parser original:
                    BSC NÃƒO inverte eixo aqui.
                    position: x, y, z
                    normal:   nx, ny, nz

                    A rotaÃ§Ã£o final do robÃ´ Ã© aplicada no CharacterRoot,
                    igual ao viewer original:
                    rotation.x = -Math.PI / 2
                    rotation.y = Math.PI
                    scale.x = -1
                */
                positions.push(p.x, p.y, p.z);
                normals.push(n.x, n.y, n.z);
                uvs.push(uv.u, uv.v);
            }

            const rawIndices = mesh.indices || [];

            for (let i = 0; i < rawIndices.length; i += 3) {
                if (i + 2 >= rawIndices.length) {
                    continue;
                }

                /*
                    BSC no parser original usa os Ã­ndices como vÃªm no arquivo.
                    A inversÃ£o i0,i2,i1 Ã© usada no OBJ, nÃ£o no BSC.
                */
                indices.push(
                    rawIndices[i],
                    rawIndices[i + 1],
                    rawIndices[i + 2]
                );
            }

            let textureName = null;
            const texId = mesh.texId ?? 0;

            if (texId >= 0 && texId < numTextures) {
                textureName = textureNameFromBaseAndTexId(modelInfo.base, texId, "bsc");
            }

            const meshName =
                mesh?.nameBuffer?.str ||
                mesh?.name ||
                `${modelInfo.base}_mesh_${meshIndex}`;

            meshData.push({
                boneName: meshName,
                textureName,
                texId,
                attributes: {
                    position: positions,
                    normal: normals,
                    uv: uvs
                },
                indices
            });
        }

        return {
            type: "bsc",
            meshData,
            internalSkeleton: {
                rootName: "Root",
                bones: [],
                animations: []
            },
            overriddenBones: [],
            inverseBindMatrices: []
        };
    }

    convertRawObjToProcessed(data, modelInfo) {
        const bones = [];
        const meshData = [];
        const numTextures = data?.header?.numTextures ?? 4;

        for (const boneData of data.bones || []) {
            const name = normalizeBoneName(boneData.name);

            const frameBytes =
                getValidFrameBytes(boneData.frameMats, 0) ||
                boneData.boneBuff;

            const matrix = bytesToMatrix4(frameBytes);

            const pos = new THREE.Vector3();
            const rot = new THREE.Quaternion();
            const scl = new THREE.Vector3();

            matrix.decompose(pos, rot, scl);
            rot.normalize();

            bones.push({
                name,
                pos: pos.toArray(),
                rot: rot.toArray(),
                scl: scl.toArray(),
                matrix: frameBytes
            });
        }

        for (const mesh of data.meshes || []) {
            const positions = [];
            const normals = [];
            const uvs = [];
            const indices = [];

            const vertices = mesh.vertices || [];

            for (const v of vertices) {
                const p = getVertexPosition(v);
                const n = getVertexNormal(v);
                const uv = getVertexUv(v);

                positions.push(-p.x, p.y, p.z);
                normals.push(-n.x, n.y, n.z);
                uvs.push(uv.u, uv.v);
            }

            const rawIndices = mesh.indices || [];

            for (let i = 0; i < rawIndices.length; i += 3) {
                if (i + 2 >= rawIndices.length) {
                    continue;
                }

                indices.push(
                    rawIndices[i],
                    rawIndices[i + 2],
                    rawIndices[i + 1]
                );
            }

            let textureName = null;

            if ((mesh.texId ?? -1) >= 0 && mesh.texId < numTextures) {
                textureName = textureNameFromBaseAndTexId(modelInfo.base, mesh.texId, "obj");
            }

            meshData.push({
                boneName: normalizeBoneName(mesh.name),
                textureName,
                texId: mesh.texId ?? 0,
                attributes: {
                    position: positions,
                    normal: normals,
                    uv: uvs
                },
                indices
            });
        }

        return {
            type: "obj",
            meshData,
            internalSkeleton: {
                rootName: "ObjRoot",
                bones,
                animations: []
            },
            overriddenBones: meshData.map(m => m.boneName),
            inverseBindMatrices: []
        };
    }

    createGeometryFromMeshData(meshData) {
        const attrs = meshData.attributes || meshData;

        const geometry = new THREE.BufferGeometry();

        const position = attrs.position || [];
        const normal = attrs.normal || [];
        const uv = attrs.uv || [];
        const indices = meshData.indices || [];

        geometry.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(position, 3)
        );

        if (normal.length) {
            geometry.setAttribute(
                "normal",
                new THREE.Float32BufferAttribute(normal, 3)
            );
        } else {
            geometry.computeVertexNormals();
        }

        if (uv.length) {
            geometry.setAttribute(
                "uv",
                new THREE.Float32BufferAttribute(uv, 2)
            );
        }

        geometry.setIndex(indices);
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();

        return geometry;
    }

    createAuraGeometryFromRawOrProcessed(meshData, rawData) {
        if (meshData?.attributes?.position?.length) {
            const pos = meshData.attributes.position;

            if (pos.length === 12) {
                const ys = [pos[1], pos[4], pos[7], pos[10]];
                const zs = [pos[2], pos[5], pos[8], pos[11]];

                const width = Math.max(...ys) - Math.min(...ys);
                const height = Math.max(...zs) - Math.min(...zs);

                return new THREE.PlaneGeometry(
                    Math.max(1, Math.abs(width)),
                    Math.max(1, Math.abs(height))
                );
            }
        }

        return this.createGeometryFromMeshData(meshData);
    }

    async getMaterialFromTexId(modelInfo, texId, auraMode = false) {
        const texturePath = modelInfo.textures?.[texId] || null;

        return await this.createMaterial(
            texturePath,
            `${modelInfo.base}:${texId}`,
            auraMode
        );
    }

    async getMaterialFromTextureName(textureName, modelInfo, auraMode = false) {
        const texturePath = makeTexturePath(this.assetPath, textureName);

        return await this.createMaterial(
            texturePath,
            `${modelInfo.base}:${textureName}`,
            auraMode
        );
    }

    async createMaterial(texturePath, key, auraMode = false) {
        if (this.materialCache.has(key)) {
            return this.materialCache.get(key);
        }

        const texture = texturePath
            ? await this.loadTextureSafe(texturePath)
            : null;

        let material;

        if (auraMode) {
            material = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                side: THREE.DoubleSide,
                depthWrite: false,
                alphaTest: 0.02
            });
        } else {
            material = new THREE.MeshStandardMaterial({
                map: texture,
                transparent: true,
                side: THREE.DoubleSide,
                alphaTest: 0.04,
                roughness: 0.62,
                metalness: 0
            });
        }

        this.materialCache.set(key, material);

        return material;
    }

    async loadTextureSafe(path) {
        if (!path) {
            return null;
        }

        if (this.textureCache.has(path)) {
            return this.textureCache.get(path);
        }

        const loader = new THREE.TextureLoader();

        try {
            const texture = await loader.loadAsync(path);

            texture.colorSpace = THREE.SRGBColorSpace;
            texture.flipY = false;
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;

            this.textureCache.set(path, texture);

            return texture;
        } catch (error) {
            console.warn("Textura nÃ£o encontrada:", path);
            return null;
        }
    }

    findCharacterBone(name) {
        const lookup = normalizeLookupName(name);

        if (this.characterBoneMap.has(lookup)) {
            return this.characterBoneMap.get(lookup);
        }

        for (const [boneName, bone] of this.characterBoneMap.entries()) {
            if (boneName.includes(lookup) || lookup.includes(boneName)) {
                return bone;
            }
        }

        return null;
    }

    findAttachTarget(modelInfo) {
        if (!this.characterBoneRoot) {
            return this.equipmentRoot;
        }

        if (!modelInfo.attach_to) {
            if (modelInfo.prefix === "aura") {
                const auraBone = this.findCharacterBone("aura_root");
                return auraBone || this.characterBoneRoot;
            }

            return this.characterBoneRoot;
        }

        if (modelInfo.attach_to === "<match>") {
            return this.characterBoneRoot;
        }

        const direct = this.findCharacterBone(modelInfo.attach_to);

        if (direct) {
            return direct;
        }

        const fallbackMap = {
            wing: "bonewing",
            shield: "bone_shield",
            shoulder: "bone_shoulder",
            flag1st: "bone_flag1",
            flag2nd: "bone_flag2",
            aura: "aura_root"
        };

        const fallbackName = fallbackMap[modelInfo.prefix];

        if (fallbackName) {
            const fallback = this.findCharacterBone(fallbackName);

            if (fallback) {
                return fallback;
            }
        }

        return this.characterBoneRoot;
    }

    centerEquipmentLocal(object) {
        object.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(object);

        if (box.isEmpty()) {
            return;
        }

        const center = new THREE.Vector3();
        box.getCenter(center);

        object.position.sub(center);
    }

    centerObject(object) {
        object.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(object);

        if (box.isEmpty()) {
            return;
        }

        const center = new THREE.Vector3();
        box.getCenter(center);

        object.position.sub(center);

        this.controls.target.set(0, 0, 0);
        this.controls.update();
    }

    disposeObject(object) {
        object.traverse((child) => {
            if (child.geometry) {
                child.geometry.dispose();
            }

            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(mat => mat.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });
    }

    animate() {
        this.animationId = requestAnimationFrame(() => this.animate());

        const delta = this.clock.getDelta();

        if (this.playing) {
            for (const mixer of this.mixers) {
                mixer.update(delta);
            }
        }

        this.updateBonAnimation(delta);

        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    resize() {
        const width = this.container.clientWidth || 500;
        const height = this.container.clientHeight || 620;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(width, height);
    }

    play() {
        this.playing = true;
    }

    pause() {
        this.playing = false;
    }

    togglePlay() {
        this.playing = !this.playing;
    }

    resetCamera() {
        this.camera.position.set(
            this.cameraPosition.x,
            this.cameraPosition.y,
            this.cameraPosition.z
        );

        this.controls.target.set(
            this.controlsTarget.x,
            this.controlsTarget.y,
            this.controlsTarget.z
        );

        this.controls.update();
    }

    destroy() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }

        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }

        this.clearEquipment();
        this.clearCharacter();

        for (const texture of this.textureCache.values()) {
            texture.dispose();
        }

        for (const material of this.materialCache.values()) {
            material.dispose();
        }

        this.textureCache.clear();
        this.materialCache.clear();

        if (this.renderer) {
            this.renderer.dispose();
        }

        if (this.container) {
            this.container.innerHTML = "";
        }
    }
}

window.EquipmentPreview = EquipmentPreview;
window.getModelFromItemId = getModelFromItemId;
window.getEquipmentFromBase = getEquipmentFromBase;
window.getBscPartFromBase = getBscPartFromBase;
window.getBonFromBase = getBonFromBase;
