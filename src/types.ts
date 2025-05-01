/**
 * Represents a parameter of a Move function
 */
export interface FunctionParam {
  /**
   * Name of the parameter
   */
  name: string;

  /**
   * Type of the parameter
   */
  type: string;

  /**
   * Whether the parameter is mutable
   */
  isMutable?: boolean;

  /**
   * Description or documentation for the parameter
   */
  description: string;
}

/**
 * Represents a Move function
 */
export interface MoveFunction {
  /**
   * Name of the function
   */
  name: string;

  /**
   * Visibility/type of the function (public, private, entry, etc.)
   */
  type: string;

  /**
   * Type parameters for generic functions
   */
  typeParameters?: string[];

  /**
   * Parameters of the function
   */
  params: FunctionParam[];

  /**
   * Return type of the function
   */
  returns: string;

  /**
   * Description or documentation for the function
   */
  description: string;

  /**
   * Function body content
   */
  body: string;

  /**
   * Whether the function is a native function
   */
  isNative?: boolean;

  /**
   * Whether the function is a macro function
   */
  isMacro?: boolean;
}

/**
 * Represents a field in a Move struct
 */
export interface StructField {
  /**
   * Name of the field
   */
  name: string;

  /**
   * Type of the field
   */
  type: string;
}

/**
 * Represents a Move struct definition
 */
export interface MoveStruct {
  /**
   * Name of the struct
   */
  name: string;

  /**
   * Abilities associated with this struct (copy, drop, store, etc.)
   */
  abilities: string[];

  /**
   * Type parameters for generic structs
   */
  typeParameters?: string[];

  /**
   * Fields contained in the struct
   */
  fields: StructField[];
}

/**
 * Represents a variant within a Move enum
 */
export interface MoveEnumVariant {
  /**
   * The name of the enum variant
   */
  name: string;

  /**
   * The fields contained within this variant
   */
  fields: StructField[];
}

/**
 * Represents a Move enum definition
 */
export interface MoveEnum {
  /**
   * The name of the enum
   */
  name: string;

  /**
   * The abilities associated with this enum (copy, drop, store, etc.)
   */
  abilities: string[];

  /**
   * Type parameters for generic enums
   */
  typeParameters: string[];

  /**
   * The variants that make up this enum
   */
  variants: MoveEnumVariant[];
}

/**
 * Represents a constant in Move
 */
export interface MoveConstant {
  /**
   * Name of the constant
   */
  name: string;

  /**
   * Type of the constant
   */
  type: string;

  /**
   * Value of the constant
   */
  value: string;
}
